import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSeen,
  consumeIntroFlag,
  readLastLook,
  readSeen,
  writeLastLook,
} from './attentionStorage';

const LAST_LOOK_KEY = 'nerve:attention:lastLook';
const SEEN_KEY = 'nerve:attention:seen';
const INTRO_KEY = 'nerve:attention:introduced';

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error('storage unavailable');
  };
  return {
    get length() {
      return fail();
    },
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  } as unknown as Storage;
}

describe('attentionStorage', () => {
  beforeEach(() => {
    localStorage.removeItem(LAST_LOOK_KEY);
    localStorage.removeItem(SEEN_KEY);
    localStorage.removeItem(INTRO_KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips last look', () => {
    expect(readLastLook()).toBeNull();

    const ts = Date.UTC(2026, 10, 27, 8, 22);
    writeLastLook(ts);

    expect(readLastLook()).toBe(ts);
    expect(localStorage.getItem(LAST_LOOK_KEY)).toBe(String(ts));
  });

  it('reads a garbled last look as none', () => {
    localStorage.setItem(LAST_LOOK_KEY, 'yesterday');
    expect(readLastLook()).toBeNull();
  });

  it('seen round-trips and merges across calls', () => {
    expect(readSeen().size).toBe(0);

    addSeen(['a', 'b']);
    const merged = addSeen(['c']);

    expect([...merged]).toEqual(['a', 'b', 'c']);
    expect([...readSeen()]).toEqual(['a', 'b', 'c']);
  });

  it('seen ignores a garbled stored value', () => {
    localStorage.setItem(SEEN_KEY, '{not json');
    expect(readSeen().size).toBe(0);

    localStorage.setItem(SEEN_KEY, JSON.stringify({ a: 1 }));
    expect(readSeen().size).toBe(0);

    localStorage.setItem(SEEN_KEY, JSON.stringify(['ok', 7, null]));
    expect([...readSeen()]).toEqual(['ok']);
  });

  it('seen is capped at 500', () => {
    const keys = Array.from({ length: 600 }, (_, i) => `k${i}`);

    const result = addSeen(keys);

    expect(result.size).toBe(500);
    expect(result.has('k599')).toBe(true);
    expect(result.has('k100')).toBe(true);
    expect(result.has('k99')).toBe(false);
    expect(readSeen().size).toBe(500);
  });

  it('seen keeps the newest when a later call overflows the cap', () => {
    addSeen(Array.from({ length: 500 }, (_, i) => `old${i}`));

    const result = addSeen(['new1', 'new2']);

    expect(result.size).toBe(500);
    expect(result.has('new1')).toBe(true);
    expect(result.has('new2')).toBe(true);
    expect(result.has('old0')).toBe(false);
    expect(result.has('old1')).toBe(false);
    expect(result.has('old2')).toBe(true);
  });

  it('marking a seen key again makes it the newest', () => {
    addSeen(['a', 'b']);
    addSeen(['a']);

    expect([...readSeen()]).toEqual(['b', 'a']);
  });

  it('intro flag is consumed once', () => {
    expect(consumeIntroFlag()).toBe(true);
    expect(localStorage.getItem(INTRO_KEY)).not.toBeNull();
    expect(consumeIntroFlag()).toBe(false);
    expect(consumeIntroFlag()).toBe(false);
  });

  it('storage that throws reads as empty', () => {
    // Seed real values first so the stub, not an empty store, explains the empty reads.
    writeLastLook(123);
    addSeen(['a']);
    vi.stubGlobal('localStorage', throwingStorage());

    expect(readLastLook()).toBeNull();
    expect(() => writeLastLook(123)).not.toThrow();
    expect(readSeen().size).toBe(0);
    expect(() => addSeen(['a'])).not.toThrow();
    expect(consumeIntroFlag()).toBe(false);
  });

  it('addSeen still returns the merged keys when the write fails', () => {
    vi.stubGlobal('localStorage', throwingStorage());

    const result = addSeen(['a', 'b']);

    expect([...result]).toEqual(['a', 'b']);
  });
});
