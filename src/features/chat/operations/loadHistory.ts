/**
 * loadHistory — Pure functions for loading, filtering, grouping, and tagging chat history.
 *
 * Extracted from ChatContext to keep the context a thin state-management wrapper.
 * All functions here are pure (no React hooks, setState, or refs).
 */
import { generateMsgId } from '@/features/chat/types';
import type { ChatMsg, ChatMsgRole, ToolGroupEntry } from '@/features/chat/types';
import type { ChatMessage, ContentBlock, ChatHistoryResponse } from '@/types';
import { extractText, describeToolUse, renderMarkdown, renderToolResults } from '@/utils/helpers';
import { decodeHtmlEntities } from '@/lib/formatting';
import { extractTTSMarkers } from '@/features/tts/useTTS';
import { extractChartMarkers } from '@/features/charts/extractCharts';
import { extractEditBlocks, extractWriteBlocks } from '@/features/chat/edit-blocks';
import { extractImages } from '@/features/chat/extractImages';
import type { MessageImage } from '@/features/chat/types';

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

  // System notifications are now rendered as collapsible strips, not hidden.
  // They pass through the filter and get tagged during message processing.

  // Hide redundant tool results for Edit/Write operations
  // (diff view already shows the changes — only hide exact success patterns)
  if (m.role === 'tool' || m.role === 'toolResult') {
    const trimmedText = text.trim();
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

/** Matches "System: [2026-02-17 20:30:23 GMT+1] ..." lines injected by the gateway. */
const SYSTEM_EVENT_LINE = /^System: \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? [^\]]*\]/;

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

/**
 * Split system event lines out of a user message text.
 * Consecutive non-system lines are joined back into a single user segment.
 */
function splitSystemEvents(text: string): Array<{ role: 'event' | 'user'; text: string }> {
  const segments: Array<{ role: 'event' | 'user'; text: string }> = [];
  let userBuffer: string[] = [];

  const flushUser = () => {
    const joined = userBuffer.join('\n').trim();
    if (joined) segments.push({ role: 'user', text: joined });
    userBuffer = [];
  };

  for (const line of text.split('\n')) {
    if (SYSTEM_EVENT_LINE.test(line)) {
      flushUser();
      segments.push({ role: 'event', text: stripAnsi(line) });
    } else {
      userBuffer.push(line);
    }
  }
  flushUser();
  return segments;
}

export function splitToolCallMessage(m: ChatMessage): ChatMsg[] {
  const ts = m.timestamp || m.createdAt || m.ts || null;
  const timestamp = ts ? new Date(ts as string | number) : new Date();

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
          result.push({
            role: 'assistant',
            html: renderToolResults(renderMarkdown(cleaned)),
            rawText: cleaned,
            timestamp,
            streaming: false,
            ...(charts.length > 0 ? { charts } : {}),
            ...(extractedImages.length > 0 ? { extractedImages } : {}),
          });
        }
        textBuffer = '';
      };

      for (const block of m.content as ContentBlock[]) {
        if (block.type === 'thinking') {
          flushText();
          const thinkingContent = (block as unknown as { thinking?: string }).thinking || block.text || '';
          if (thinkingContent.trim()) {
            result.push({
              role: 'assistant',
              html: renderMarkdown(thinkingContent),
              rawText: thinkingContent,
              timestamp,
              isThinking: true,
            });
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
          result.push({
            role: 'tool',
            html: renderMarkdown(desc),
            rawText: `**tool:** \`${block.name}\`\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``,
            timestamp,
            streaming: false,
          });
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
          result.push({
            role: m.role as ChatMsgRole,
            html: '',
            rawText: '',
            timestamp,
            images: contentImages,
          });
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

  // Split system events out of user messages into separate event bubbles
  if (m.role === 'user' && SYSTEM_EVENT_LINE.test(rawText)) {
    const segments = splitSystemEvents(rawText);
    if (segments.some(s => s.role === 'event')) {
      return segments.map(seg => {
        const { cleaned: ttsStripped } = extractTTSMarkers(seg.text);
        const { cleaned: chartCleaned, charts } = extractChartMarkers(ttsStripped);
        return {
          role: seg.role as ChatMsgRole,
          html: renderToolResults(renderMarkdown(chartCleaned)),
          rawText: chartCleaned,
          timestamp,
          streaming: false,
          ...(charts.length > 0 ? { charts } : {}),
          ...(isVoice && seg.role === 'user' ? { isVoice: true } : {}),
        };
      });
    }
  }

  const { cleaned: ttsStripped } = extractTTSMarkers(rawText);
  const { cleaned: chartCleaned, charts } = extractChartMarkers(ttsStripped);
  const isAssistant = m.role === 'assistant';
  const { cleaned: text, images: extractedImages } = isAssistant
    ? extractImages(chartCleaned)
    : { cleaned: chartCleaned, images: [] };

  // Extract image content blocks (base64 images from gateway)
  const contentImages = Array.isArray(m.content) ? extractImageBlocks(m.content as ContentBlock[]) : [];

  // Tag system notifications (subagent/cron completions) for collapsible strip rendering
  const sysNotif = m.role === 'user' ? detectSystemNotification(rawText) : { match: false, label: '' };

  return [{
    role: m.role as ChatMsgRole,
    html: renderToolResults(renderMarkdown(text)),
    rawText: text,
    timestamp,
    streaming: false,
    ...(charts.length > 0 ? { charts } : {}),
    ...(extractedImages.length > 0 ? { extractedImages } : {}),
    ...(contentImages.length > 0 ? { images: contentImages } : {}),
    ...(isVoice ? { isVoice: true } : {}),
    ...(sysNotif.match ? { isSystemNotification: true, systemLabel: sysNotif.label } : {}),
  }];
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
      grouped.push({
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
export function processChatMessages(messages: ChatMessage[]): ChatMsg[] {
  const chatMsgs: ChatMsg[] = messages
    .filter(filterMessage)
    .flatMap(splitToolCallMessage);

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

  return processChatMessages(msgs);
}
