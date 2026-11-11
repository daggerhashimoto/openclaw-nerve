/**
 * Edge TTS — free text-to-speech via Microsoft Edge's speech service.
 *
 * Implements the WebSocket protocol directly (no npm dependency beyond `ws`).
 * Uses the same endpoint the Edge browser's Read Aloud feature talks to.
 * Includes Sec-MS-GEC token generation for anti-abuse auth.
 *
 * Default voice options:
 *  - en-US-AriaNeural, en-US-GuyNeural, en-US-JennyNeural (American)
 *  - en-GB-SoniaNeural, en-GB-RyanNeural (British)
 * @module
 */

import { WebSocket } from 'ws';
import crypto from 'node:crypto';

const BASE_URL =
  'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

import { getTTSConfig, resolveEdgeTTSVoice } from '../lib/tts-config.js';

const DEFAULT_VOICE = 'en-US-AriaNeural';

export type EdgeWordTiming = {word: string; start: number; end: number};

// Windows epoch offset: seconds between 1601-01-01 and 1970-01-01
const WIN_EPOCH = 11644473600;

function uuid(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

function escapeXml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[
        c
      ]!,
  );
}

export function parseEdgeWordBoundaryMessage(message: string): EdgeWordTiming[] {
  if (!message.includes('Path:audio.metadata')) return [];
  const body = message.split('\r\n\r\n', 2)[1];
  if (!body) return [];
  try {
    const payload = JSON.parse(body) as {
      Metadata?: Array<{
        Type?: string;
        Data?: {Offset?: number; Duration?: number; text?: {Text?: string}};
      }>;
    };
    return (payload.Metadata ?? []).flatMap((entry) => {
      const word = String(entry.Data?.text?.Text ?? '').trim();
      const offset = Number(entry.Data?.Offset);
      const duration = Number(entry.Data?.Duration);
      if (entry.Type !== 'WordBoundary' || !word || !Number.isFinite(offset) || !Number.isFinite(duration)) {
        return [];
      }
      const start = Math.max(0, offset / 10_000_000);
      const end = start + Math.max(0, duration / 10_000_000);
      return [{
        word,
        start: Math.round(start * 1_000_000) / 1_000_000,
        end: Math.round(end * 1_000_000) / 1_000_000,
      }];
    });
  } catch {
    return [];
  }
}

/**
 * Generate the Sec-MS-GEC token required by Microsoft's anti-abuse system.
 * Based on: https://github.com/rany2/edge-tts/blob/master/src/edge_tts/drm.py
 */
function generateSecMsGec(): string {
  // Current time in seconds (Unix epoch)
  let ticks = Date.now() / 1000;
  // Convert to Windows file time epoch
  ticks += WIN_EPOCH;
  // Round down to nearest 5 minutes (300 seconds)
  ticks -= ticks % 300;
  // Convert to 100-nanosecond intervals (Windows file time format)
  ticks *= 1e7;
  // Hash: ticks + trusted client token
  const strToHash = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
}

function buildWsUrl(): string {
  const secMsGec = generateSecMsGec();
  return (
    `wss://${BASE_URL}/edge/v1` +
    `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${secMsGec}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
    `&ConnectionId=${uuid()}`
  );
}

/** Derive BCP-47 locale from an Edge voice id, e.g. zh-CN-XiaoxiaoNeural -> zh-CN. */
function deriveVoiceLocale(voiceName: string): string {
  const match = voiceName.match(/^([a-z]{2,3}-[A-Z]{2})-/);
  return match?.[1] || 'en-US';
}

export async function synthesizeEdge(
  text: string,
  voice?: string,
  includeWordBoundaries = false,
): Promise<
  { ok: true; buf: Buffer; words: EdgeWordTiming[] } | { ok: false; message: string; status: number }
> {
  // Voice resolution: explicit param > language-aware config > tts-config.json > DEFAULT_VOICE
  const resolved = resolveEdgeTTSVoice();
  const effectiveVoice = voice || resolved.voice || getTTSConfig().edge.voice || DEFAULT_VOICE;
  console.log(`[edge-tts] Starting synthesis, voice=${effectiveVoice}`);
  try {
    const synthesis = await new Promise<{buf: Buffer; words: EdgeWordTiming[]}>((resolve, reject) => {
      const muid = crypto.randomBytes(16).toString('hex').toUpperCase();
      const ws = new WebSocket(buildWsUrl(), {
        host: 'speech.platform.bing.com',
        origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        headers: {
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Cookie': `muid=${muid};`,
        },
      });

      const audioData: Buffer[] = [];
      const words: EdgeWordTiming[] = [];
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Edge TTS timeout after 30s'));
      }, 30_000);

      ws.on('message', (rawData: Buffer, isBinary: boolean) => {
        if (!isBinary) {
          const data = rawData.toString('utf8');
          if (includeWordBoundaries) words.push(...parseEdgeWordBoundaryMessage(data));
          if (data.includes('turn.end')) {
            clearTimeout(timeout);
            resolve({buf: Buffer.concat(audioData), words});
            ws.close();
          }
          return;
        }
        const separator = 'Path:audio\r\n';
        const idx = rawData.indexOf(separator);
        if (idx >= 0) {
          audioData.push(rawData.subarray(idx + separator.length));
        }
      });

      ws.on('error', (err) => {
        console.error('[edge-tts] WebSocket error:', err.message);
        clearTimeout(timeout);
        reject(err);
      });

      const speechConfig = JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: {
                sentenceBoundaryEnabled: false,
                wordBoundaryEnabled: includeWordBoundaries,
              },
              outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
            },
          },
        },
      });

      const configMessage =
        `X-Timestamp:${new Date().toString()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n${speechConfig}`;

      ws.on('open', () => {
        console.log('[edge-tts] WebSocket connected, sending config...');
        ws.send(configMessage, { compress: true }, (err) => {
          if (err) {
            clearTimeout(timeout);
            return reject(err);
          }

          const voiceLocale = deriveVoiceLocale(effectiveVoice);
          const ssmlMessage =
            `X-RequestId:${uuid()}\r\nContent-Type:application/ssml+xml\r\n` +
            `X-Timestamp:${new Date().toString()}Z\r\nPath:ssml\r\n\r\n` +
            `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${escapeXml(voiceLocale)}'>` +
            `<voice name='${escapeXml(effectiveVoice)}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>` +
            `${escapeXml(text)}</prosody></voice></speak>`;

          ws.send(ssmlMessage, { compress: true }, (ssmlErr) => {
            if (ssmlErr) {
              clearTimeout(timeout);
              reject(ssmlErr);
            }
          });
        });
      });
    });

    if (synthesis.buf.length === 0) {
      return { ok: false, message: 'Edge TTS returned empty audio', status: 500 };
    }
    return { ok: true, ...synthesis };
  } catch (err) {
    console.error('[edge-tts] error:', (err as Error).message);
    return {
      ok: false,
      message: `Edge TTS failed: ${(err as Error).message}`,
      status: 502,
    };
  }
}
