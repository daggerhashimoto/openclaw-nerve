import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from './useWebSocket';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  
  sentMessages: string[] = [];
  url: string;
  
  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    setTimeout(() => {
      this.onclose?.(new CloseEvent('close'));
    }, 0);
  }

  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

function getConnectRequest(ws: MockWebSocket): Record<string, unknown> | null {
  const connectReq = ws.sentMessages.find(m => {
    try {
      const parsed = JSON.parse(m) as Record<string, unknown>;
      return parsed.method === 'connect';
    } catch {
      return false;
    }
  });

  if (!connectReq) return null;
  return JSON.parse(connectReq) as Record<string, unknown>;
}

describe('useWebSocket', () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket;
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
    window.sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Connection States', () => {
    it('should start in disconnected state', () => {
      const { result } = renderHook(() => useWebSocket());
      expect(result.current.connectionState).toBe('disconnected');
    });

    it('should transition to connecting state when connect is called', async () => {
      const { result } = renderHook(() => useWebSocket());
      
      act(() => {
        result.current.connect('ws://localhost:8080', 'test-token');
      });

      expect(result.current.connectionState).toBe('connecting');
    });

    it('should transition to disconnected when disconnect is called', async () => {
      const { result } = renderHook(() => useWebSocket());
      
      act(() => {
        result.current.connect('ws://localhost:8080', 'test-token');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      act(() => {
        result.current.disconnect();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.connectionState).toBe('disconnected');
    });
  });

  describe('Connect handshake payload', () => {
    it('should identify as the OpenClaw control UI client', async () => {
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWS = MockWebSocket;
      (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = class extends OriginalMockWS {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      };

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connect('ws://localhost:8080', 'test-token');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const ws = wsInstances[0];
      act(() => {
        ws.simulateMessage({ type: 'event', event: 'connect.challenge', payload: { nonce: 'n0' } });
      });

      const connectReq = getConnectRequest(ws);
      const client = (connectReq?.params as { client?: { id?: string; mode?: string } } | undefined)?.client;

      expect(client?.id).toBe('openclaw-control-ui');
      expect(client?.mode).toBe('webchat');
    });

    it('should include a stable per-tab client.instanceId in connect params', async () => {
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWS = MockWebSocket;
      (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = class extends OriginalMockWS {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      };

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connect('ws://localhost:8080', 'test-token');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const ws = wsInstances[0];
      act(() => {
        ws.simulateMessage({ type: 'event', event: 'connect.challenge', payload: { nonce: 'n1' } });
      });

      const connectReq = getConnectRequest(ws);
      expect(connectReq).toBeTruthy();

      const params = connectReq?.params as { client?: { instanceId?: string } } | undefined;
      expect(params?.client?.instanceId).toBeTruthy();
      expect(typeof params?.client?.instanceId).toBe('string');
    });

    it('should reuse the same instanceId across reconnects in the same tab', async () => {
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWS = MockWebSocket;
      (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = class extends OriginalMockWS {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      };

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connect('ws://localhost:8080', 'test-token');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const firstWs = wsInstances[0];
      act(() => {
        firstWs.simulateMessage({ type: 'event', event: 'connect.challenge', payload: { nonce: 'first' } });
      });

      const firstConnectReq = getConnectRequest(firstWs);
      expect(firstConnectReq).toBeTruthy();

      const firstInstanceId = (firstConnectReq?.params as { client?: { instanceId?: string } } | undefined)
        ?.client?.instanceId;
      expect(firstInstanceId).toBeTruthy();

      // complete auth so reconnect is enabled
      const firstReqId = firstConnectReq?.id as string | undefined;
      expect(firstReqId).toBeTruthy();
      act(() => {
        firstWs.simulateMessage({ type: 'res', id: firstReqId, ok: true, payload: {} });
      });

      // unexpected close triggers reconnect
      act(() => {
        firstWs.close();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(wsInstances.length).toBeGreaterThanOrEqual(2);
      const secondWs = wsInstances[1];

      act(() => {
        secondWs.simulateMessage({ type: 'event', event: 'connect.challenge', payload: { nonce: 'second' } });
      });

      const secondConnectReq = getConnectRequest(secondWs);
      const secondInstanceId = (secondConnectReq?.params as { client?: { instanceId?: string } } | undefined)
        ?.client?.instanceId;

      expect(secondInstanceId).toBe(firstInstanceId);
    });
  });

  describe('Reconnection Logic', () => {
    /** Simulate the gateway auth handshake so hasConnectedRef becomes true. */
    function simulateAuthHandshake(ws: MockWebSocket) {
      // Gateway sends connect.challenge
      ws.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'event', event: 'connect.challenge', data: {} })
      }));
      // Find the connect request the hook sent and reply with ok
      const connectReq = ws.sentMessages.find(m => m.includes('"method":"connect"'));
      if (connectReq) {
        const parsed = JSON.parse(connectReq);
        ws.onmessage?.(new MessageEvent('message', {
          data: JSON.stringify({ type: 'res', id: parsed.id, ok: true })
        }));
      }
    }

    it('should attempt to reconnect after unexpected disconnect', async () => {
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWS = MockWebSocket;
      (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = class extends OriginalMockWS {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      };

      const { result } = renderHook(() => useWebSocket());
      
      // Initial connection
      act(() => {
        result.current.connect('ws://localhost:8080', 'test-token');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(wsInstances.length).toBeGreaterThanOrEqual(1);

      // Complete the auth handshake so reconnect is allowed
      const firstWs = wsInstances[0];
      act(() => {
        simulateAuthHandshake(firstWs);
      });

      // Simulate unexpected close
      act(() => {
        firstWs.close();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.connectionState).toBe('reconnecting');
      expect(result.current.reconnectAttempt).toBeGreaterThan(0);
    });

    it('should stop reconnecting after intentional disconnect', async () => {
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWS = MockWebSocket;
      (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = class extends OriginalMockWS {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      };

      const { result } = renderHook(() => useWebSocket());
      
      act(() => {
        result.current.connect('ws://localhost:8080', 'test-token');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const initialCount = wsInstances.length;

      // Intentional disconnect
      act(() => {
        result.current.disconnect();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Wait for potential reconnect attempt
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(wsInstances.length).toBe(initialCount);
      expect(result.current.connectionState).toBe('disconnected');
      expect(result.current.reconnectAttempt).toBe(0);
    });

    it('should manage reconnect counter', async () => {
      const { result } = renderHook(() => useWebSocket());
      
      expect(result.current.reconnectAttempt).toBe(0);
      
      act(() => {
        result.current.connect('ws://localhost:8080', 'test-token');
      });

      expect(result.current.reconnectAttempt).toBe(0);
      
      act(() => {
        result.current.disconnect();
      });

      expect(result.current.reconnectAttempt).toBe(0);
    });

    it('should keep reconnecting after a reconnect auth failure', async () => {
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWS = MockWebSocket;
      (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = class extends OriginalMockWS {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      };

      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.connect('ws://localhost:8080', 'test-token');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const firstWs = wsInstances[0];
      act(() => {
        simulateAuthHandshake(firstWs);
      });

      act(() => {
        firstWs.close();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(wsInstances.length).toBeGreaterThanOrEqual(2);
      const reconnectWs = wsInstances[1];
      act(() => {
        reconnectWs.simulateMessage({ type: 'event', event: 'connect.challenge', payload: { nonce: 'retry-1' } });
      });

      const reconnectReq = getConnectRequest(reconnectWs);
      expect(reconnectReq).toBeTruthy();
      const reconnectReqId = reconnectReq?.id as string;

      act(() => {
        reconnectWs.simulateMessage({
          type: 'res',
          id: reconnectReqId,
          ok: false,
          error: { message: 'temporary auth issue' },
        });
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.connectionState).toBe('reconnecting');
      expect(result.current.reconnectAttempt).toBeGreaterThan(0);
      expect(wsInstances.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('RPC Timeout Handling', () => {
    it('should timeout RPC calls after 30 seconds', async () => {
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWS = MockWebSocket;
      (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = class extends OriginalMockWS {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
          this.readyState = MockWebSocket.OPEN;
        }
      };

      const { result } = renderHook(() => useWebSocket());
      
      act(() => {
        result.current.connect('ws://localhost:8080', 'test-token');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      let rpcError: Error | null = null;
      act(() => {
        result.current.rpc('test.method', { foo: 'bar' }).catch((e: unknown) => {
          rpcError = e as Error;
        });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(31000);
      });

      expect(rpcError).not.toBeNull();
      expect(rpcError?.message).toBe('Timeout');
    });

    it('should reject RPC calls when not connected', async () => {
      const { result } = renderHook(() => useWebSocket());
      
      let rpcError: Error | null = null;
      await act(async () => {
        try {
          await result.current.rpc('test.method');
        } catch (e) {
          rpcError = e as Error;
        }
      });

      expect(rpcError).not.toBeNull();
      expect(rpcError?.message).toBe('Not connected');
    });

    it('should handle RPC with params', async () => {
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWS = MockWebSocket;
      (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = class extends OriginalMockWS {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
          this.readyState = MockWebSocket.OPEN;
        }
      };

      const { result } = renderHook(() => useWebSocket());
      
      act(() => {
        result.current.connect('ws://localhost:8080', 'test-token');
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      act(() => {
        result.current.rpc('test.method', { foo: 'bar', num: 42 }).catch(() => {});
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const ws = wsInstances[0];
      expect(ws.sentMessages.length).toBeGreaterThan(0);
      
      const rpcMsg = ws.sentMessages.find(msg => {
        const parsed = JSON.parse(msg);
        return parsed.method === 'test.method';
      });
      
      expect(rpcMsg).toBeDefined();
      if (rpcMsg) {
        const parsed = JSON.parse(rpcMsg);
        expect(parsed.type).toBe('req');
        expect(parsed.params).toEqual({ foo: 'bar', num: 42 });
      }
    });
  });

  describe('Security - Connection Validation', () => {
    it('should support secure WebSocket URLs (wss://)', async () => {
      const { result } = renderHook(() => useWebSocket());
      
      act(() => {
        result.current.connect('wss://secure.example.com', 'token');
      });

      expect(result.current.connectionState).toBe('connecting');
    });

    it('should handle connection errors gracefully', async () => {
      const { result } = renderHook(() => useWebSocket());
      
      expect(() => {
        act(() => {
          result.current.connect('ws://localhost:8080', 'test-token');
        });
      }).not.toThrow();
    });

    it('should clear error state on successful disconnect', async () => {
      const { result } = renderHook(() => useWebSocket());
      
      act(() => {
        result.current.disconnect();
      });

      expect(result.current.connectError).toBe('');
    });
  });
});
