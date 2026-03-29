/** Tests for the shared gateway RPC client (persistent WebSocket). */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { WebSocketServer } from 'ws';

// Mock config to point at our test server
let testPort: number;
vi.mock('./config.js', () => ({
  get config() {
    return {
      gatewayUrl: `http://127.0.0.1:${testPort}`,
      gatewayToken: 'test-token',
      port: 3080,
    };
  },
}));

const { createDeviceBlockMock } = vi.hoisted(() => ({
  createDeviceBlockMock: vi.fn(({ nonce, clientId, clientMode, role, scopes, token }) => ({
    id: 'device-123',
    publicKey: 'pubkey-123',
    signature: `sig-${nonce}`,
    signedAt: 1234567890,
    nonce,
    _debug: { clientId, clientMode, role, scopes, token },
  })),
}));

vi.mock('./device-identity.js', () => ({
  createDeviceBlock: createDeviceBlockMock,
}));

import {
  gatewayRpcCall,
  gatewayFilesList,
  gatewayFilesGet,
  gatewayFilesSet,
} from './gateway-rpc.js';

let wss: WebSocketServer;

async function importFreshGatewayRpc() {
  for (const client of wss.clients) client.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  vi.resetModules();
  return await import('./gateway-rpc.js');
}

describe('gateway-rpc (persistent WebSocket)', () => {
  /** Handler for incoming RPC method calls (after connect handshake) */
  let rpcHandler: (method: string, params: unknown) => unknown;
  let lastConnectParams: unknown = null;
  let connectMode: 'accept' | 'reject' | 'close' = 'accept';

  beforeAll(async () => {
    rpcHandler = () => ({});

    wss = new WebSocketServer({ port: 0 });
    testPort = (wss.address() as { port: number }).port;

    wss.on('connection', (ws) => {
      // Send challenge immediately
      ws.send(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'test-nonce', ts: Date.now() },
      }));

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.method === 'connect') {
          lastConnectParams = msg.params;
          if (connectMode === 'reject') {
            ws.send(JSON.stringify({ type: 'res', id: msg.id, ok: false, error: { message: 'connect rejected by test server' } }));
            return;
          }
          if (connectMode === 'close') {
            ws.close();
            return;
          }
          ws.send(JSON.stringify({ type: 'res', id: msg.id, ok: true, payload: {} }));
          return;
        }

        // RPC call
        try {
          const result = rpcHandler(msg.method, msg.params);
          ws.send(JSON.stringify({ type: 'res', id: msg.id, ok: true, payload: result }));
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'res', id: msg.id, ok: false,
            error: { message: (err as Error).message },
          }));
        }
      });
    });
  });

  afterAll(() => {
    wss.close();
  });

  beforeEach(() => {
    rpcHandler = () => ({});
    lastConnectParams = null;
    connectMode = 'accept';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('gatewayRpcCall', () => {
    it('injects device identity into the gateway connect handshake', async () => {
      rpcHandler = () => ({ ok: true });

      await gatewayRpcCall('test.method', { foo: 'bar' });

      expect(createDeviceBlockMock).toHaveBeenCalledWith({
        clientId: 'openclaw-control-ui',
        clientMode: 'webchat',
        role: 'operator',
        scopes: ['operator.admin', 'operator.read', 'operator.write'],
        token: 'test-token',
        nonce: 'test-nonce',
      });
      expect(lastConnectParams).toMatchObject({
        client: {
          id: 'openclaw-control-ui',
          mode: 'webchat',
        },
        auth: { token: 'test-token' },
        device: {
          id: 'device-123',
          publicKey: 'pubkey-123',
          signature: 'sig-test-nonce',
          nonce: 'test-nonce',
        },
      });
    });

    it('sends RPC request and returns payload', async () => {
      rpcHandler = (method, params) => {
        expect(method).toBe('test.method');
        expect(params).toEqual({ foo: 'bar' });
        return { result: 'ok' };
      };

      const result = await gatewayRpcCall('test.method', { foo: 'bar' });
      expect(result).toEqual({ result: 'ok' });
    });

    it('rejects on RPC error response', async () => {
      rpcHandler = () => { throw new Error('not found'); };
      await expect(gatewayRpcCall('test.fail', {})).rejects.toThrow('not found');
    });

    it('handles multiple sequential calls on the same connection', async () => {
      let callCount = 0;
      rpcHandler = () => {
        callCount++;
        return { n: callCount };
      };

      const r1 = await gatewayRpcCall('call.one', {});
      const r2 = await gatewayRpcCall('call.two', {});
      expect(r1).toEqual({ n: 1 });
      expect(r2).toEqual({ n: 2 });
    });

    it('handles concurrent calls', async () => {
      rpcHandler = (_method, params) => {
        return { echo: (params as Record<string, unknown>).value };
      };

      const [r1, r2, r3] = await Promise.all([
        gatewayRpcCall('echo', { value: 'a' }),
        gatewayRpcCall('echo', { value: 'b' }),
        gatewayRpcCall('echo', { value: 'c' }),
      ]);
      expect(r1).toEqual({ echo: 'a' });
      expect(r2).toEqual({ echo: 'b' });
      expect(r3).toEqual({ echo: 'c' });
    });

    it('rejects when the gateway rejects the initial connect handshake', async () => {
      connectMode = 'reject';
      const { gatewayRpcCall } = await importFreshGatewayRpc();
      await expect(gatewayRpcCall('test.method', {})).rejects.toThrow('connect rejected by test server');
    });

    it('rejects when the socket closes before connect completes', async () => {
      connectMode = 'close';
      const { gatewayRpcCall } = await importFreshGatewayRpc();
      await expect(gatewayRpcCall('test.method', {})).rejects.toThrow(/closed before connect completed/i);
    });
  });

  describe('gatewayFilesList', () => {
    it('returns files from gateway response', async () => {
      const mockFiles = [
        { name: 'SOUL.md', path: 'SOUL.md', missing: false, size: 100, updatedAtMs: 1000 },
      ];
      rpcHandler = () => ({ files: mockFiles });

      const result = await gatewayFilesList('main');
      expect(result).toEqual(mockFiles);
    });

    it('returns empty array when no files', async () => {
      rpcHandler = () => ({});
      expect(await gatewayFilesList('main')).toEqual([]);
    });
  });

  describe('gatewayFilesGet', () => {
    it('extracts content from nested file field', async () => {
      rpcHandler = () => ({
        agentId: 'main',
        workspace: '/sandbox/.openclaw/workspace',
        file: { name: 'SOUL.md', missing: false, size: 7, updatedAtMs: 1000, content: '# Soul' },
      });

      const result = await gatewayFilesGet('main', 'SOUL.md');
      expect(result?.content).toBe('# Soul');
    });

    it('returns null for missing files', async () => {
      rpcHandler = () => ({ file: { name: 'X.md', missing: true } });
      expect(await gatewayFilesGet('main', 'X.md')).toBeNull();
    });

    it('returns null on error', async () => {
      rpcHandler = () => { throw new Error('unsupported'); };
      expect(await gatewayFilesGet('main', 'bad.md')).toBeNull();
    });
  });

  describe('gatewayFilesSet', () => {
    it('sends correct params', async () => {
      let received: unknown;
      rpcHandler = (_m, p) => { received = p; return { ok: true }; };

      await gatewayFilesSet('main', 'SOUL.md', '# New');
      expect(received).toEqual({ agentId: 'main', name: 'SOUL.md', content: '# New' });
    });

    it('rejects on error', async () => {
      rpcHandler = () => { throw new Error('write failed'); };
      await expect(gatewayFilesSet('main', 'X', 'y')).rejects.toThrow('write failed');
    });
  });
});
