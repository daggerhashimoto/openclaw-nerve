import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';

// Vitest/jsdom in some environments does not provide a full Storage impl.
// Ensure localStorage exists and supports clear/getItem/setItem for hooks/tests.

type GlobalWithStorage = typeof globalThis & {
  localStorage?: Storage;
  window?: Window & { localStorage?: Storage };
};

function isStorage(value: unknown): value is Storage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Storage;
  return (
    typeof v.getItem === 'function' &&
    typeof v.setItem === 'function' &&
    typeof v.removeItem === 'function'
  );
}

(() => {
  const g = globalThis as unknown as GlobalWithStorage;
  const existing = g.localStorage ?? g.window?.localStorage;
  if (isStorage(existing) && typeof existing.clear === 'function') return;

  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };

  // Avoid inter-test leakage when using the shim
  beforeEach(() => storage.clear());

  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  if (g.window) {
    Object.defineProperty(g.window, 'localStorage', { value: storage, configurable: true });
  }
})();

