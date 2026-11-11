import { describe, expect, it } from 'vitest';
import { pcm16ToWav } from './openai-realtime-tts.js';

describe('pcm16ToWav', () => {
  it('wraps 24 kHz mono PCM in a playable WAV header', () => {
    const pcm = Buffer.from([0, 0, 255, 127]);
    const wav = pcm16ToWav(pcm);

    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44)).toEqual(pcm);
  });
});
