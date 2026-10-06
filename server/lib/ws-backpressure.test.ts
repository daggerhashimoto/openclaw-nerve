import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { BoundedWebSocketSender } from './ws-backpressure.js';

class MockSocket {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  sent: Array<{ data: Buffer | string; binary: boolean }> = [];
  close = vi.fn((code?: number, reason?: string) => {
    this.readyState = WebSocket.CLOSED;
    this.closeCode = code;
    this.closeReason = reason;
  });
  closeCode?: number;
  closeReason?: string;
  private callbacks: Array<(err?: Error) => void> = [];

  send(data: Buffer | string, options: { binary?: boolean }, callback?: (err?: Error) => void) {
    this.sent.push({ data, binary: options.binary ?? false });
    if (callback) this.callbacks.push(callback);
  }

  flushOne() {
    this.callbacks.shift()?.();
  }
}

/** Peer that never reads: every send stays in bufferedAmount, like a stalled TCP window. */
class StalledSocket extends MockSocket {
  override send(data: Buffer | string, options: { binary?: boolean }, callback?: (err?: Error) => void) {
    super.send(data, options, callback);
    this.bufferedAmount += typeof data === 'string' ? Buffer.byteLength(data) : data.length;
  }
}

const MiB = 1024 * 1024;

describe('BoundedWebSocketSender', () => {
  it('queues while the peer is above the buffered threshold and drains when it recovers', () => {
    const socket = new MockSocket();
    socket.bufferedAmount = 32;
    const sender = new BoundedWebSocketSender(socket, {
      label: 'test-peer',
      maxBufferedBytes: 16,
      resumeBufferedBytes: 8,
      maxQueueMessages: 4,
      maxQueueBytes: 1024,
    });

    expect(sender.send('queued-one', false)).toBe(true);
    expect(socket.sent).toHaveLength(0);
    expect(sender.stats()).toMatchObject({ queuedMessages: 1 });

    socket.bufferedAmount = 0;
    sender.drain();

    expect(socket.sent).toEqual([{ data: 'queued-one', binary: false }]);
    expect(sender.stats()).toMatchObject({ queuedMessages: 0 });
  });

  it('closes a slow peer instead of growing an unbounded queue', () => {
    const socket = new MockSocket();
    socket.bufferedAmount = 32;
    const onOverflow = vi.fn();
    const sender = new BoundedWebSocketSender(socket, {
      label: 'slow-peer',
      maxBufferedBytes: 16,
      resumeBufferedBytes: 8,
      maxQueueMessages: 1,
      maxQueueBytes: 12,
      closeCode: 1013,
      closeReason: 'Backpressure overflow',
      onOverflow,
    });

    expect(sender.send('first', false)).toBe(true);
    expect(sender.send('second', false)).toBe(false);

    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(socket.close).toHaveBeenCalledWith(1013, 'Backpressure overflow');
    expect(sender.stats()).toMatchObject({ closed: true });
  });

  it('preserves binary framing for queued data', () => {
    const socket = new MockSocket();
    socket.bufferedAmount = 32;
    const sender = new BoundedWebSocketSender(socket, {
      label: 'binary-peer',
      maxBufferedBytes: 16,
      resumeBufferedBytes: 8,
      maxQueueMessages: 4,
      maxQueueBytes: 1024,
    });
    const payload = Buffer.from([1, 2, 3]);

    expect(sender.send(payload, true)).toBe(true);
    socket.bufferedAmount = 0;
    sender.drain();

    expect(socket.sent).toEqual([{ data: payload, binary: true }]);
  });

  it('forwards a single frame larger than the buffered cap when the peer is idle', () => {
    const socket = new MockSocket();
    const onOverflow = vi.fn();
    const sender = new BoundedWebSocketSender(socket, { label: 'idle-peer', onOverflow });
    const historyFrame = Buffer.alloc(20 * MiB);

    expect(sender.send(historyFrame, true)).toBe(true);

    expect(socket.sent).toHaveLength(1);
    expect(onOverflow).not.toHaveBeenCalled();
    expect(sender.stats()).toMatchObject({ closed: false, queuedMessages: 0 });
  });

  it('bounds a stalled peer to one oversized in-flight frame plus the queue cap', () => {
    const socket = new StalledSocket();
    const onOverflow = vi.fn();
    const sender = new BoundedWebSocketSender(socket, { label: 'stalled-peer', onOverflow });

    // First oversized frame goes out directly; it raises bufferedAmount past the cap.
    expect(sender.send(Buffer.alloc(20 * MiB), true)).toBe(true);
    expect(socket.bufferedAmount).toBe(20 * MiB);

    // A second oversized frame cannot bypass the cap: it must enqueue, which overflows.
    expect(sender.send(Buffer.alloc(20 * MiB), true)).toBe(false);
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(socket.close).toHaveBeenCalledWith(1013, 'Peer backlog exceeded');
    expect(socket.sent).toHaveLength(1);
    expect(socket.bufferedAmount).toBe(20 * MiB);
  });

  it('queues small frames behind an oversized in-flight frame until the queue cap closes the peer', () => {
    const socket = new StalledSocket();
    const onOverflow = vi.fn();
    const sender = new BoundedWebSocketSender(socket, { label: 'stalled-peer', onOverflow });

    expect(sender.send(Buffer.alloc(20 * MiB), true)).toBe(true);

    let accepted = 0;
    while (sender.send(Buffer.alloc(64 * 1024), true)) accepted++;

    expect(accepted).toBe(16); // 16 x 64 KiB fills the 1 MiB queue cap
    expect(socket.sent).toHaveLength(1);
    expect(socket.bufferedAmount).toBe(20 * MiB);
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(sender.stats()).toMatchObject({ closed: true, queuedMessages: 0, queuedBytes: 0 });
  });
});
