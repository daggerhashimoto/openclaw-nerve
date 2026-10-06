/**
 * loadHistory — Pure functions for loading, filtering, grouping, and tagging chat history.
 *
 * Extracted from ChatContext to keep the context a thin state-management wrapper.
 * All functions here are pure (no React hooks, setState, or refs).
 */
import { generateMsgId, stableMsgId } from '@/features/chat/types';
import type { ChatMsg, ChatMsgRole, ToolGroupEntry, UploadAttachmentDescriptor } from '@/features/chat/types';
import type { ChatMessage, ContentBlock, ChatHistoryResponse } from '@/types';
import { extractText, describeToolUse, renderMarkdown, renderToolResults } from '@/utils/helpers';
import { decodeHtmlEntities } from '@/lib/formatting';
import { extractTTSMarkers } from '@/features/tts/useTTS';
import { extractChartMarkers } from '@/features/charts/extractCharts';
import { extractEditBlocks, extractWriteBlocks } from '@/features/chat/edit-blocks';
import { extractImages } from '@/features/chat/extractImages';
import type { MessageImage } from '@/features/chat/types';

function toArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function stableHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function getMessageTimestampValue(message: ChatMessage): string {
  const value = message.timestamp ?? message.createdAt ?? message.ts ?? message.__openclaw?.recordTimestampMs;
  return value === undefined || value === null ? '' : String(value);
}

function getDurableMessageBase(message: ChatMessage, options: { sessionKey?: string; messageIndex?: number } = {}): string | null {
  const openclaw = message.__openclaw;
  if (openclaw?.mirrorIdentity) return `openclaw:mirror:${openclaw.mirrorIdentity}`;
  if (openclaw?.id) return `openclaw:id:${openclaw.id}`;
  if (message.id) return `message:id:${message.id}`;
  if (message.messageId) return `message:id:${message.messageId}`;
  if (message.message_id) return `message:id:${message.message_id}`;
  if (message.idempotencyKey) return `message:idempotency:${message.idempotencyKey}`;
  if (message.toolCallId) return `message:tool:${message.toolCallId}:${message.role}`;

  const sequence = message.seq ?? message.__openclaw?.seq;
  const timestamp = getMessageTimestampValue(message);
  if (timestamp) {
    const session = options.sessionKey || 'unknown-session';
    const stablePosition = sequence ?? (typeof options.messageIndex === 'number' ? `index:${options.messageIndex}` : null);
    if (stablePosition !== null) {
      return `derived:${session}:${message.role}:${stablePosition}:${timestamp}`;
    }
    return `derived:${session}:${message.role}:${timestamp}`;
  }

  if (typeof options.messageIndex === 'number') {
    const session = options.sessionKey || 'unknown-session';
    return `derived:${session}:${message.role}:index:${options.messageIndex}:${stableHash(JSON.stringify(message.content))}`;
  }

  return null;
}

function getDurableMessageAliases(message: ChatMessage): string[] {
  const aliases = [
    message.idempotencyKey ? `message:idempotency:${message.idempotencyKey}` : null,
    message.toolCallId ? `message:tool:${message.toolCallId}:${message.role}` : null,
    message.id ? `message:id:${message.id}` : null,
    message.messageId ? `message:id:${message.messageId}` : null,
    message.message_id ? `message:id:${message.message_id}` : null,
    message.__openclaw?.id ? `openclaw:id:${message.__openclaw.id}` : null,
    message.__openclaw?.mirrorIdentity ? `openclaw:mirror:${message.__openclaw.mirrorIdentity}` : null,
  ].filter((value): value is string => Boolean(value));

  return [...new Set(aliases)];
}

function withSourceIdentity(
  msg: ChatMsg,
  base: string | null,
  aliases: string[],
  part: string,
): ChatMsg {
  if (!base) return msg;
  const sourceId = part ? `${base}:${part}` : base;
  const alternateSourceIds = aliases
    .filter((alias) => alias !== base)
    .map((alias) => (part ? `${alias}:${part}` : alias));
  return {
    ...msg,
    sourceId,
    ...(alternateSourceIds.length > 0 ? { alternateSourceIds } : {}),
    msgId: stableMsgId(sourceId),
  };
}

function getFilenameFromPathish(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const segments = trimmed.split('/').filter(Boolean);
  return segments[segments.length - 1] || fallback;
}

function imageExtensionFromMimeType(mimeType?: string): string {
  if (!mimeType?.startsWith('image/')) return 'png';
  const subtype = mimeType.slice('image/'.length).toLowerCase();
  if (subtype === 'jpeg') return 'jpg';
  return subtype || 'png';
}

function dedupeExtractedImages(images: Array<{ url: string; alt?: string }>): Array<{ url: string; alt?: string }> {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });
}

function extractLegacyMessageImages(
  message: ChatMessage,
  options: { sessionKey?: string; messageTimestampMs?: number },
): Array<{ url: string; alt?: string }> {
  const extracted: Array<{ url: string; alt?: string }> = [];

  for (const mediaPath of [...toArray(message.MediaPath), ...toArray(message.MediaPaths)]) {
    const trimmedPath = mediaPath.trim();
    if (!trimmedPath) continue;
    extracted.push({
      url: `/api/files?path=${encodeURIComponent(trimmedPath)}`,
      alt: getFilenameFromPathish(trimmedPath, 'image'),
    });
  }

  for (const mediaUrl of [...toArray(message.MediaUrl), ...toArray(message.MediaUrls)]) {
    const trimmedUrl = mediaUrl.trim();
    if (!trimmedUrl) continue;
    extracted.push({
      url: trimmedUrl,
      alt: getFilenameFromPathish(trimmedUrl.split('?')[0] || trimmedUrl, 'image'),
    });
  }

  if (options.sessionKey && Number.isFinite(options.messageTimestampMs) && Array.isArray(message.content)) {
    const timestampMs = options.messageTimestampMs as number;
    let imageIndex = 0;
    for (const block of message.content) {
      if (block.type !== 'image') continue;
      if (block.omitted) {
        const extension = imageExtensionFromMimeType(block.mimeType || block.source?.media_type);
        extracted.push({
          url: `/api/sessions/media?sessionKey=${encodeURIComponent(options.sessionKey)}&timestamp=${timestampMs}&imageIndex=${imageIndex}`,
          alt: `message-${timestampMs}-image-${imageIndex}.${extension}`,
        });
      }
      imageIndex += 1;
    }
  }

  return extracted;
}

/** Convert an image content block (from gateway) into a MessageImage for rendering. */
function imageBlockToMessageImage(block: ContentBlock): MessageImage | null {
  // Format 1: { type: "image", data: "base64...", mimeType: "image/jpeg" }
  if (block.data && block.mimeType) {
    const dataUrl = `data:${block.mimeType};base64,${block.data}`;
    return { mimeType: block.mimeType, content: block.data, preview: dataUrl, name: 'image' };
  }
  // Format 2: { type: "image", source: { type: "base64", media_type: "image/png", data: "..." } }
  if (block.source?.data && block.source?.media_type) {
    const dataUrl = `data:${block.source.media_type};base64,${block.source.data}`;
    return { mimeType: block.source.media_type, content: block.source.data, preview: dataUrl, name: 'image' };
  }
  return null;
}

/** Extract MessageImage[] from content blocks. */
function extractImageBlocks(content: ContentBlock[]): MessageImage[] {
  return content
    .filter(b => b.type === 'image')
    .map(imageBlockToMessageImage)
    .filter((img): img is MessageImage => img !== null);
}

// ─── RPC type alias ────────────────────────────────────────────────────────────
type RpcFn = (method: string, params: Record<string, unknown>) => Promise<unknown>;

// ─── Filtering ─────────────────────────────────────────────────────────────────

/** Patterns that identify system notification messages (subagent/cron completions). */
const SYSTEM_NOTIFICATION_PATTERNS = [
  /^A \w[\w\s-]* task "(.+?)" just (completed|finished|failed|timed out)/is,
  /^A background task/i,
  /^A cron job "(.+?)" just (completed|finished|failed)/is,
  /^\[Queued announce messages while agent was busy\]/i,
  /^\[System Message\].*?(?:subagent|task|cron).*?(?:completed|finished|failed)/is,
];

/** Matches timestamped gateway-injected system lines, including untrusted variants. */
const SYSTEM_EVENT_LINE = /^System(?: \(untrusted\))?: \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? [^\]]*\]/;

/** Internal follow-up lines appended after async exec/cron system events. */
const SYSTEM_EVENT_FOLLOWUP_LINE = /^(?:An async command you ran earlier has completed\.|A scheduled reminder has been triggered\.|A scheduled cron event was triggered(?:, but no event content was found)?\.|Handle this reminder internally\.|Handle this internally\.|Handle the result internally\.?|Do not relay it to the user unless explicitly requested\.|Please relay the command output to the user in a helpful way\.|Please relay this reminder to the user in a helpful and friendly way\.|Current time:)/i;

/** Internal assistant control replies that should never render as chat bubbles. */
const INTERNAL_CONTROL_REPLY_RE = /^(?:NO_REPLY|HEARTBEAT_OK)$/;

function isInternalWakeBundle(text: string): boolean {
  let sawSystemEvent = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (SYSTEM_EVENT_LINE.test(line)) {
      sawSystemEvent = true;
      continue;
    }
    if (SYSTEM_EVENT_FOLLOWUP_LINE.test(line)) continue;
    return false;
  }

  return sawSystemEvent;
}

/** Check if text matches a system notification and extract label. */
export function detectSystemNotification(text: string): { match: boolean; label: string } {
  // Extract task/job name from quotes if present
  const taskMatch = text.match(/(?:task|job)\s+"([^"]+)"/i);
  const label = taskMatch?.[1] || 'System notification';

  // Detect status
  const statusMatch = text.match(/just\s+(completed|finished|failed|timed out)/i);
  const status = statusMatch?.[1]?.toLowerCase();

  for (const pattern of SYSTEM_NOTIFICATION_PATTERNS) {
    if (pattern.test(text)) {
      return { match: true, label: status ? `${label} — ${status}` : label };
    }
  }

  // Also catch "Findings:" + "Summarize this naturally" blocks
  if (/\bFindings:\b/.test(text) && /\bSummarize this naturally\b/i.test(text)) {
    return {
      match: true,
      label: label !== 'System notification'
        ? (status ? `${label} — ${status}` : label)
        : 'Agent relay',
    };
  }

  return { match: false, label: '' };
}

/** Determine whether a history message should be shown in the chat UI. */
export function filterMessage(m: ChatMessage): boolean {
  const text = extractText(m);
  const trimmedText = text.trim();

  if (m.role === 'assistant' && INTERNAL_CONTROL_REPLY_RE.test(trimmedText)) {
    return false;
  }

  if (m.role === 'user' && isInternalWakeBundle(trimmedText)) {
    return false;
  }

  // System notifications are now rendered as collapsible strips, not hidden.
  // They pass through the filter and get tagged during message processing.

  // Hide redundant tool results for Edit/Write operations
  // (diff view already shows the changes — only hide exact success patterns)
  if (m.role === 'tool' || m.role === 'toolResult') {
    if (/^Successfully replaced text in .+\.$/.test(trimmedText)) return false;
    if (/^Successfully wrote \d+ bytes to .+\.$/.test(trimmedText)) return false;
  }

  return true;
}

// ─── Splitting ─────────────────────────────────────────────────────────────────

/**
 * Split an assistant message into interleaved text + tool ChatMsg objects.
 *
 * text → tool_use → text → tool_use → text becomes:
 *   [assistant, tool, assistant, tool, assistant]
 *
 * Non-assistant messages (or assistant messages without tool_use blocks) are
 * returned as a single-element array.
 */
// ─── System event splitting ────────────────────────────────────────────────────

/** Strip the TTS system prompt hint appended to voice messages by sendMessage. */
const TTS_SYSTEM_HINT_RE = /\s*\[system: User sent a voice message\.[\s\S]*$/;

/**
 * Strip the "Conversation info (untrusted metadata)" envelope that the OpenClaw
 * gateway (≥2026.2.17) prepends to webchat user messages. The decoration includes
 * emoji, a JSON block with message_id/sender, and a timestamp prefix.
 * Pattern:  Conversation info (untrusted metadata):\n...\njson{...}\n[timestamp] <actual message>
 */
const WEBCHAT_ENVELOPE_RE = /Conversation info \(untrusted metadata\):[\s\S]*?"sender":\s*"[^"]*"\s*\}\s*\n?(?:```\s*\n?)?(?:\n?\[[\w, ]+ \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? [^\]]*\]\s*)?/g;

/** Strip ANSI escape sequences (e.g. \x1b[33m) from terminal output. */
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[\d*(?:;\d+)*m/g, '');

const UPLOAD_MANIFEST_RE = /\s*<nerve-upload-manifest>([\s\S]*?)<\/nerve-upload-manifest>\s*$/;

function extractUploadAttachments(rawText: string): {
  cleanedText: string;
  uploadAttachments?: UploadAttachmentDescriptor[];
} {
  const match = rawText.match(UPLOAD_MANIFEST_RE);
  if (!match) return { cleanedText: rawText };

  const cleanedText = rawText.replace(UPLOAD_MANIFEST_RE, '').trimEnd();

  try {
    const parsed = JSON.parse(match[1]) as { attachments?: UploadAttachmentDescriptor[] };
    if (!Array.isArray(parsed.attachments) || parsed.attachments.length === 0) {
      return { cleanedText };
    }
    return {
      cleanedText,
      uploadAttachments: parsed.attachments,
    };
  } catch {
    return { cleanedText: rawText };
  }
}

/**
 * Split system event lines out of a user message text.
 * Consecutive non-system lines are joined back into a single user segment.
 */
function splitSystemEvents(text: string): Array<{ role: 'event' | 'user'; text: string }> {
  const segments: Array<{ role: 'event' | 'user'; text: string }> = [];
  let userBuffer: string[] = [];
  let sawSystemEvent = false;

  const flushUser = () => {
    const joined = userBuffer.join('\n').trim();
    if (joined) segments.push({ role: 'user', text: joined });
    userBuffer = [];
  };

  for (const line of text.split('\n')) {
    if (SYSTEM_EVENT_LINE.test(line)) {
      flushUser();
      segments.push({ role: 'event', text: stripAnsi(line) });
      sawSystemEvent = true;
    } else {
      const trimmed = line.trim();
      if (sawSystemEvent) {
        if (!trimmed || SYSTEM_EVENT_FOLLOWUP_LINE.test(trimmed)) {
          continue;
        }
        sawSystemEvent = false;
      }
      userBuffer.push(line);
    }
  }
  flushUser();
  return segments;
}

export function splitToolCallMessage(m: ChatMessage, options: { sessionKey?: string; messageIndex?: number } = {}): ChatMsg[] {
  const ts = m.timestamp ?? m.createdAt ?? m.ts ?? m.__openclaw?.recordTimestampMs ?? null;
  const parsedTimestamp = ts ? new Date(ts as string | number) : null;
  const hasPersistedTimestamp = Boolean(parsedTimestamp && Number.isFinite(parsedTimestamp.getTime()));
  const timestamp = hasPersistedTimestamp ? parsedTimestamp as Date : new Date();
  const identityBase = getDurableMessageBase(m, options);
  const identityAliases = getDurableMessageAliases(m);

  // Only interleave for assistant messages with array content containing tool_use
  if (m.role === 'assistant' && Array.isArray(m.content)) {
    const hasTools = (m.content as ContentBlock[]).some(
      b => b.type === 'tool_use' || b.type === 'toolCall',
    );
    const hasThinking = (m.content as ContentBlock[]).some(
      b => b.type === 'thinking',
    );

    if (hasTools || hasThinking) {
      const result: ChatMsg[] = [];
      let textBuffer = '';
      const contentImages = extractImageBlocks(m.content as ContentBlock[]);

      const flushText = () => {
        if (!textBuffer.trim()) { textBuffer = ''; return; }
        const { cleaned: ttsStripped } = extractTTSMarkers(textBuffer.trim());
        const { cleaned: chartCleaned, charts } = extractChartMarkers(ttsStripped);
        const { cleaned, images: extractedImages } = extractImages(chartCleaned);
        if (cleaned.trim() || extractedImages.length > 0) {
          result.push(withSourceIdentity({
            role: 'assistant',
            html: renderToolResults(renderMarkdown(cleaned)),
            rawText: cleaned,
            timestamp,
            streaming: false,
            ...(charts.length > 0 ? { charts } : {}),
            ...(extractedImages.length > 0 ? { extractedImages } : {}),
          }, identityBase, identityAliases, `text:${result.length}`));
        }
        textBuffer = '';
      };

      for (const block of m.content as ContentBlock[]) {
        if (block.type === 'thinking') {
          flushText();
          const thinkingContent = (block as unknown as { thinking?: string }).thinking || block.text || '';
          if (thinkingContent.trim()) {
            result.push(withSourceIdentity({
              role: 'assistant',
              html: renderMarkdown(thinkingContent),
              rawText: thinkingContent,
              timestamp,
              isThinking: true,
            }, identityBase, identityAliases, `thinking:${result.length}`));
          }
        } else if (block.type === 'text' && block.text) {
          textBuffer += (textBuffer ? '\n' : '') + block.text;
        } else if (block.type === 'tool_use' || block.type === 'toolCall') {
          flushText();
          const rawArgs = block.input || block.arguments || {};
          const args: Record<string, unknown> = typeof rawArgs === 'string'
            ? (() => { try { return JSON.parse(rawArgs); } catch { return { value: rawArgs }; } })()
            : rawArgs;
          const desc = describeToolUse(block.name || 'unknown', args) || block.name || 'unknown';
          result.push(withSourceIdentity({
            role: 'tool',
            html: renderMarkdown(desc),
            rawText: `**tool:** \`${block.name}\`\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``,
            timestamp,
            streaming: false,
          }, identityBase, identityAliases, block.id || block.toolCallId || `tool:${result.length}`));
        }
      }
      flushText(); // Final text block

      // Attach any image content blocks to the result
      if (contentImages.length > 0) {
        // Find last assistant message to attach images to, or create one
        const lastAssistant = [...result].reverse().find(r => r.role === 'assistant' || r.role === m.role as ChatMsgRole);
        if (lastAssistant) {
          lastAssistant.images = [...(lastAssistant.images || []), ...contentImages];
        } else {
          result.push(withSourceIdentity({
            role: m.role as ChatMsgRole,
            html: '',
            rawText: '',
            timestamp,
            images: contentImages,
          }, identityBase, identityAliases, 'images'));
        }
      }

      return result;
    }
  }

  // Normal message (no tool calls, or non-assistant)
  let rawText = extractText(m);

  // Strip gateway decorations from user messages
  let isVoice = false;
  if (m.role === 'user') {
    rawText = rawText.replace(TTS_SYSTEM_HINT_RE, '');
    rawText = rawText.replace(WEBCHAT_ENVELOPE_RE, '');
    // Detect voice messages before stripping the marker
    isVoice = /\[voice\]\s/.test(rawText);
    // Strip the [voice] prefix tag (internal marker for TTS hint injection)
    rawText = rawText.replace(/^\[voice\]\s*/, '');
    // After all decorations are removed, a voice-only message with no
    // transcription text becomes empty — drop it to avoid a ghost bubble.
    if (!rawText.trim()) return [];
  }

  const { cleanedText: uploadManifestStripped, uploadAttachments } = m.role === 'user'
    ? extractUploadAttachments(rawText)
    : { cleanedText: rawText, uploadAttachments: undefined };

  rawText = uploadManifestStripped;

  // Split system events out of user messages into separate event bubbles
  if (m.role === 'user' && SYSTEM_EVENT_LINE.test(rawText)) {
    const segments = splitSystemEvents(rawText);
    if (segments.some(s => s.role === 'event')) {
      return segments.map((seg, index) => {
        const { cleaned: ttsStripped } = extractTTSMarkers(seg.text);
        const { cleaned: chartCleaned, charts } = extractChartMarkers(ttsStripped);
        return withSourceIdentity({
          role: seg.role as ChatMsgRole,
          html: renderToolResults(renderMarkdown(chartCleaned)),
          rawText: chartCleaned,
          timestamp,
          streaming: false,
          ...(charts.length > 0 ? { charts } : {}),
          ...(isVoice && seg.role === 'user' ? { isVoice: true } : {}),
          ...(uploadAttachments && seg.role === 'user' ? { uploadAttachments } : {}),
        }, identityBase, identityAliases, `${seg.role}:${index}`);
      });
    }
  }

  const { cleaned: ttsStripped } = extractTTSMarkers(rawText);
  const { cleaned: chartCleaned, charts } = extractChartMarkers(ttsStripped);
  const isAssistant = m.role === 'assistant';
  const { cleaned: text, images: extractedImages } = isAssistant
    ? extractImages(chartCleaned)
    : { cleaned: chartCleaned, images: [] };
  const legacyExtractedImages = extractLegacyMessageImages(m, {
    sessionKey: options.sessionKey,
    messageTimestampMs: hasPersistedTimestamp ? timestamp.getTime() : undefined,
  });
  const combinedExtractedImages = dedupeExtractedImages([...extractedImages, ...legacyExtractedImages]);

  // Extract image content blocks (base64 images from gateway)
  const contentImages = Array.isArray(m.content) ? extractImageBlocks(m.content as ContentBlock[]) : [];

  // Tag system notifications (subagent/cron completions) for collapsible strip rendering
  const sysNotif = m.role === 'user' ? detectSystemNotification(rawText) : { match: false, label: '' };

  return [withSourceIdentity({
    role: m.role as ChatMsgRole,
    html: renderToolResults(renderMarkdown(text)),
    rawText: text,
    timestamp,
    streaming: false,
    ...(charts.length > 0 ? { charts } : {}),
    ...(combinedExtractedImages.length > 0 ? { extractedImages: combinedExtractedImages } : {}),
    ...(contentImages.length > 0 ? { images: contentImages } : {}),
    ...(uploadAttachments ? { uploadAttachments } : {}),
    ...(isVoice ? { isVoice: true } : {}),
    ...(sysNotif.match ? { isSystemNotification: true, systemLabel: sysNotif.label } : {}),
  }, identityBase, identityAliases, '')];
}

// ─── Grouping ──────────────────────────────────────────────────────────────────

/** Collapse consecutive tool messages into grouped bubbles. */
export function groupToolMessages(msgs: ChatMsg[]): ChatMsg[] {
  const grouped: ChatMsg[] = [];
  let toolBuffer: ChatMsg[] = [];
  // Images rescued from dropped tool results — attach to next assistant message
  let pendingImages: MessageImage[] = [];

  const flushTools = () => {
    if (toolBuffer.length === 0) return;

    // Filter out raw tool result messages that don't contain edit/write content.
    // Tool_use entries have rawText starting with "**tool:**"; everything else is a raw result.
    // Only keep raw results if they contain edit blocks (diffs) or write blocks (file views).
    const filtered: ChatMsg[] = [];
    for (const t of toolBuffer) {
      const isToolUse = t.rawText.startsWith('**tool:**');
      if (isToolUse) {
        filtered.push(t);
      } else {
        // Raw result — only keep if it has edit/write content worth displaying
        const hasEdits = extractEditBlocks(t.rawText).length > 0;
        const hasWrites = extractWriteBlocks(t.rawText).length > 0;
        if (hasEdits || hasWrites) {
          filtered.push(t);
        } else if (t.images && t.images.length > 0) {
          // Rescue images from tool results that would otherwise be dropped.
          // These get attached to the next assistant message for display.
          pendingImages.push(...t.images);
        }
      }
    }

    if (filtered.length === 1) {
      grouped.push(filtered[0]);
    } else if (filtered.length > 1) {
      const entries: ToolGroupEntry[] = filtered.map(t => {
        const plainPreview = decodeHtmlEntities(t.html.replace(/<[^>]*>/g, '').trim());
        return { html: t.html, rawText: t.rawText, preview: plainPreview || t.rawText.slice(0, 80) };
      });
      const groupedSourceIds = filtered.map(t => t.sourceId).filter(Boolean);
      const sourceId = groupedSourceIds.length > 0 ? `group:${groupedSourceIds.join('+')}` : undefined;
      const groupedAliasParts = filtered.map(t => [t.sourceId, ...(t.alternateSourceIds || [])].filter(Boolean));
      const alternateSourceIds = sourceId
        ? groupedAliasParts.reduce<string[]>((aliases, parts, index) => {
          for (const part of parts) {
            const candidateParts = groupedSourceIds.map((canonical, candidateIndex) => (
              candidateIndex === index ? part : canonical
            ));
            if (candidateParts.every(Boolean)) aliases.push(`group:${candidateParts.join('+')}`);
          }
          return aliases;
        }, []).filter((alias) => alias !== sourceId)
        : [];
      grouped.push({
        ...(sourceId ? { sourceId, msgId: stableMsgId(sourceId) } : {}),
        ...(alternateSourceIds.length > 0 ? { alternateSourceIds: [...new Set(alternateSourceIds)] } : {}),
        role: 'tool',
        html: `Used ${entries.length} tools`,
        rawText: entries.map(e => e.preview).join('\n'),
        timestamp: toolBuffer[0].timestamp,
        toolGroup: entries,
      });
    }
    toolBuffer = [];
  };

  for (const msg of msgs) {
    if (msg.role === 'tool' || msg.role === 'toolResult') {
      toolBuffer.push(msg);
    } else {
      flushTools();
      // Attach any rescued images from preceding tool results
      if (pendingImages.length > 0 && msg.role === 'assistant') {
        grouped.push({ ...msg, images: [...(msg.images || []), ...pendingImages] });
        pendingImages = [];
      } else {
        grouped.push(msg);
      }
    }
  }
  flushTools();

  // If images remain after the last flush (no following assistant message),
  // create a standalone message for them
  if (pendingImages.length > 0) {
    const lastTs = grouped.length > 0 ? grouped[grouped.length - 1].timestamp : new Date();
    grouped.push({
      role: 'assistant',
      html: '',
      rawText: '',
      timestamp: lastTs,
      images: pendingImages,
    });
    pendingImages = [];
  }

  return grouped;
}

// ─── Intermediate tagging ──────────────────────────────────────────────────────

/**
 * Mark assistant messages that are "intermediate" — narration between tool calls,
 * not the final answer.
 *
 * An assistant message is intermediate if it is followed by tool messages before
 * the next user message (or end of conversation).
 */
export function tagIntermediateMessages(msgs: ChatMsg[]): ChatMsg[] {
  // Work on a shallow copy so we don't mutate the input
  const tagged = msgs.map(m => ({ ...m }));

  for (let i = 0; i < tagged.length; i++) {
    if (tagged[i].role !== 'assistant' || tagged[i].isThinking) continue;
    let hasToolAfter = false;
    for (let j = i + 1; j < tagged.length; j++) {
      if (tagged[j].role === 'user') break;
      if (tagged[j].role === 'tool' || tagged[j].role === 'toolResult' || tagged[j].toolGroup) {
        hasToolAfter = true;
        break;
      }
    }
    if (hasToolAfter && !(tagged[i].charts?.length)) {
      tagged[i].intermediate = true;
    }
  }

  return tagged;
}

// ─── Full pipeline ─────────────────────────────────────────────────────────────

/**
 * Run an arbitrary ChatMessage[] through the same transcript processing pipeline
 * used by chat.history:
 *
 * filter → split → group → tag
 */
export function processChatMessages(messages: ChatMessage[], options: { sessionKey?: string } = {}): ChatMsg[] {
  const chatMsgs: ChatMsg[] = messages.flatMap((message, messageIndex) => (
    filterMessage(message)
      ? splitToolCallMessage(message, { ...options, messageIndex })
      : []
  ));

  const grouped = groupToolMessages(chatMsgs);
  const tagged = tagIntermediateMessages(grouped);

  // Assign stable IDs to any message missing one (for React keying).
  for (const msg of tagged) {
    if (!msg.msgId) msg.msgId = generateMsgId();
  }
  return tagged;
}

/**
 * Load chat history from the gateway, returning fully processed ChatMsg[].
 *
 * Pipeline: fetch → filter → split → group → tag
 *
 * The caller is responsible for calling `setMessages(result)`.
 */
export async function loadChatHistory(params: {
  rpc: RpcFn;
  sessionKey: string;
  limit?: number;
}): Promise<ChatMsg[]> {
  const { rpc, sessionKey, limit = 100 } = params;

  const res = await rpc('chat.history', { sessionKey, limit }) as ChatHistoryResponse;
  const msgs = res?.messages || [];

  return processChatMessages(msgs, { sessionKey });
}
