import { describe, expect, it, vi } from 'vitest';
import { BoundedSSEWriter } from './sse-backpressure.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('BoundedSSEWriter', () => {
  it('serializes writes so a slow stream cannot create parallel write pressure', async () => {
    const first = deferred<void>();
    const writeSSE = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const writer = new BoundedSSEWriter({ writeSSE }, {
      label: 'sse-test',
      maxQueueMessages: 4,
      maxQueueBytes: 1024,
      writeTimeoutMs: 1000,
    });

    expect(writer.enqueue({ event: 'one', data: '1' })).toBe(true);
    expect(writer.enqueue({ event: 'two', data: '2' })).toBe(true);
    expect(writer.enqueue({ event: 'three', data: '3' })).toBe(true);
    expect(writeSSE).toHaveBeenCalledTimes(1);
    expect(writer.stats()).toMatchObject({ queuedMessages: 2 });

    first.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writeSSE).toHaveBeenCalledTimes(3);
    expect(writer.stats()).toMatchObject({ queuedMessages: 0 });
  });

  it('disconnects slow clients when the bounded queue overflows', () => {
    const writeSSE = vi.fn().mockReturnValue(new Promise(() => {}));
    const onDisconnect = vi.fn();
    const writer = new BoundedSSEWriter({ writeSSE }, {
      label: 'sse-overflow',
      maxQueueMessages: 1,
      maxQueueBytes: 1024,
      writeTimeoutMs: 1000,
      onDisconnect,
    });

    expect(writer.enqueue({ event: 'one', data: '1' })).toBe(true);
    expect(writer.enqueue({ event: 'two', data: '2' })).toBe(true);
    expect(writer.enqueue({ event: 'three', data: '3' })).toBe(false);

    expect(onDisconnect).toHaveBeenCalledWith('queue overflow');
    expect(writer.stats()).toMatchObject({ closed: true });
  });

  it('disconnects when a stream write does not settle before the timeout', async () => {
    vi.useFakeTimers();
    try {
      const onDisconnect = vi.fn();
      const writer = new BoundedSSEWriter({ writeSSE: vi.fn().mockReturnValue(new Promise(() => {})) }, {
        label: 'sse-timeout',
        maxQueueMessages: 4,
        maxQueueBytes: 1024,
        writeTimeoutMs: 25,
        onDisconnect,
      });

      expect(writer.enqueue({ event: 'one', data: '1' })).toBe(true);

      await vi.advanceTimersByTimeAsync(26);

      expect(onDisconnect).toHaveBeenCalledWith('write timeout');
      expect(writer.stats()).toMatchObject({ closed: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
