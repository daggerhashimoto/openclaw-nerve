interface SSEMessage {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

interface SSEStreamLike {
  writeSSE(message: SSEMessage): Promise<void>;
  abort?: () => void;
}

export interface SSEBackpressureOptions {
  label: string;
  maxQueueMessages?: number;
  maxQueueBytes?: number;
  writeTimeoutMs?: number;
  onDisconnect?: (reason: string) => void;
  logger?: Pick<Console, 'warn' | 'debug'>;
}

const DEFAULT_MAX_QUEUE_MESSAGES = 64;
const DEFAULT_MAX_QUEUE_BYTES = 256 * 1024;
const DEFAULT_WRITE_TIMEOUT_MS = 5_000;

function messageBytes(message: SSEMessage): number {
  return Buffer.byteLength(message.event ?? '') +
    Buffer.byteLength(message.id ?? '') +
    Buffer.byteLength(String(message.retry ?? '')) +
    Buffer.byteLength(message.data);
}

export class BoundedSSEWriter {
  private readonly stream: SSEStreamLike;
  private readonly label: string;
  private readonly maxQueueMessages: number;
  private readonly maxQueueBytes: number;
  private readonly writeTimeoutMs: number;
  private readonly onDisconnect?: (reason: string) => void;
  private readonly logger: Pick<Console, 'warn' | 'debug'>;
  private queue: Array<{ message: SSEMessage; bytes: number }> = [];
  private queuedBytes = 0;
  private writing = false;
  private closed = false;

  constructor(stream: SSEStreamLike, options: SSEBackpressureOptions) {
    this.stream = stream;
    this.label = options.label;
    this.maxQueueMessages = options.maxQueueMessages ?? DEFAULT_MAX_QUEUE_MESSAGES;
    this.maxQueueBytes = options.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES;
    this.writeTimeoutMs = options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
    this.onDisconnect = options.onDisconnect;
    this.logger = options.logger ?? console;
  }

  enqueue(message: SSEMessage): boolean {
    if (this.closed) return false;
    const bytes = messageBytes(message);
    if (this.queue.length >= this.maxQueueMessages || this.queuedBytes + bytes > this.maxQueueBytes) {
      this.disconnect('queue overflow');
      return false;
    }

    this.queue.push({ message, bytes });
    this.queuedBytes += bytes;
    void this.drain();
    return true;
  }

  close(): void {
    this.closed = true;
    this.queue = [];
    this.queuedBytes = 0;
  }

  stats() {
    return {
      queuedMessages: this.queue.length,
      queuedBytes: this.queuedBytes,
      closed: this.closed,
    };
  }

  private async drain(): Promise<void> {
    if (this.writing || this.closed) return;
    this.writing = true;

    try {
      while (!this.closed && this.queue.length > 0) {
        const next = this.queue.shift()!;
        this.queuedBytes -= next.bytes;
        await this.writeWithTimeout(next.message);
      }
    } catch (err) {
      this.disconnect(err instanceof Error ? err.message : String(err));
    } finally {
      this.writing = false;
    }
  }

  private async writeWithTimeout(message: SSEMessage): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        this.stream.writeSSE(message),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('write timeout')), this.writeTimeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private disconnect(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    this.queuedBytes = 0;
    this.logger.warn(`[sse] closing ${this.label}: ${reason}`);
    this.stream.abort?.();
    this.onDisconnect?.(reason);
  }
}
