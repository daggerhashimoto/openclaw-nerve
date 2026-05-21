import { WebSocket } from 'ws';

type WebSocketData = Buffer | string;

interface WebSocketFrame {
  data: WebSocketData;
  isBinary: boolean;
  bytes: number;
}

interface WebSocketLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: WebSocketData, options: { binary?: boolean }, callback?: (err?: Error) => void): void;
  close(code?: number, reason?: string): void;
}

export interface WebSocketBackpressureOptions {
  label: string;
  maxBufferedBytes?: number;
  resumeBufferedBytes?: number;
  maxQueueMessages?: number;
  maxQueueBytes?: number;
  closeCode?: number;
  closeReason?: string;
  onOverflow?: () => void;
  logger?: Pick<Console, 'warn' | 'debug'>;
}

const DEFAULT_MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
const DEFAULT_RESUME_BUFFERED_BYTES = 512 * 1024;
const DEFAULT_MAX_QUEUE_MESSAGES = 128;
const DEFAULT_MAX_QUEUE_BYTES = 1024 * 1024;
const DEFAULT_CLOSE_CODE = 1013;
const DEFAULT_CLOSE_REASON = 'Peer backlog exceeded';
const RETRY_DRAIN_MS = 100;

function frameBytes(data: WebSocketData): number {
  return typeof data === 'string' ? Buffer.byteLength(data) : data.length;
}

function toOutboundData(data: Buffer | string, isBinary: boolean): WebSocketData {
  return isBinary ? data : data.toString();
}

export class BoundedWebSocketSender {
  private readonly socket: WebSocketLike;
  private readonly label: string;
  private readonly maxBufferedBytes: number;
  private readonly resumeBufferedBytes: number;
  private readonly maxQueueMessages: number;
  private readonly maxQueueBytes: number;
  private readonly closeCode: number;
  private readonly closeReason: string;
  private readonly onOverflow?: () => void;
  private readonly logger: Pick<Console, 'warn' | 'debug'>;
  private queue: WebSocketFrame[] = [];
  private queuedBytes = 0;
  private closed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(socket: WebSocketLike, options: WebSocketBackpressureOptions) {
    this.socket = socket;
    this.label = options.label;
    this.maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.resumeBufferedBytes = options.resumeBufferedBytes ?? DEFAULT_RESUME_BUFFERED_BYTES;
    this.maxQueueMessages = options.maxQueueMessages ?? DEFAULT_MAX_QUEUE_MESSAGES;
    this.maxQueueBytes = options.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES;
    this.closeCode = options.closeCode ?? DEFAULT_CLOSE_CODE;
    this.closeReason = options.closeReason ?? DEFAULT_CLOSE_REASON;
    this.onOverflow = options.onOverflow;
    this.logger = options.logger ?? console;
  }

  send(data: Buffer | string, isBinary: boolean): boolean {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return false;

    const outbound = toOutboundData(data, isBinary);
    const frame: WebSocketFrame = {
      data: outbound,
      isBinary,
      bytes: frameBytes(outbound),
    };

    if (this.queue.length > 0 || this.socket.bufferedAmount > this.maxBufferedBytes) {
      return this.enqueue(frame);
    }

    this.sendNow(frame);
    return true;
  }

  drain(): void {
    if (this.closed) return;
    this.clearRetryTimer();

    while (
      this.queue.length > 0 &&
      this.socket.readyState === WebSocket.OPEN &&
      this.socket.bufferedAmount <= this.resumeBufferedBytes
    ) {
      const next = this.queue.shift()!;
      this.queuedBytes -= next.bytes;
      this.sendNow(next);
    }

    if (this.queue.length > 0) this.scheduleDrain();
  }

  dispose(): void {
    this.closed = true;
    this.queue = [];
    this.queuedBytes = 0;
    this.clearRetryTimer();
  }

  stats() {
    return {
      queuedMessages: this.queue.length,
      queuedBytes: this.queuedBytes,
      closed: this.closed,
    };
  }

  private enqueue(frame: WebSocketFrame): boolean {
    if (
      this.queue.length >= this.maxQueueMessages ||
      this.queuedBytes + frame.bytes > this.maxQueueBytes
    ) {
      this.closeForOverflow();
      return false;
    }

    this.queue.push(frame);
    this.queuedBytes += frame.bytes;
    this.scheduleDrain();
    return true;
  }

  private sendNow(frame: WebSocketFrame): void {
    try {
      this.socket.send(frame.data, { binary: frame.isBinary }, (err?: Error) => {
        if (err) {
          this.closeForSendError(err);
          return;
        }
        this.drain();
      });
    } catch (err) {
      this.closeForSendError(err);
    }
  }

  /** Transport-level send failure. Distinct from queue overflow — does NOT
   *  fire `onOverflow` and closes with a generic code, not 1013. */
  private closeForSendError(err: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.clearRetryTimer();
    this.queue = [];
    this.queuedBytes = 0;
    this.logger.warn(
      `[backpressure] send failed for ${this.label}: ${err instanceof Error ? err.message : String(err)}`,
    );
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
  }

  private scheduleDrain(): void {
    if (this.retryTimer || this.closed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.drain();
    }, RETRY_DRAIN_MS);
  }

  private closeForOverflow(detail?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.clearRetryTimer();
    this.queue = [];
    this.queuedBytes = 0;
    this.logger.warn(`[backpressure] closing ${this.label}: ${detail || this.closeReason}`);
    this.onOverflow?.();
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close(this.closeCode, this.closeReason);
    }
  }

  private clearRetryTimer(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
