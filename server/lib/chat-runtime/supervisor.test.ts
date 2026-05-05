import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterGatewayEvent } from './adapter.js';
import type { ChatRuntime } from './runtime.js';

type GatewayListener = (event: AdapterGatewayEvent) => void;

let gatewayListeners: GatewayListener[];
let subscribeGatewayEventsMock: ReturnType<typeof vi.fn>;
let gatewayRpcCallMock: ReturnType<typeof vi.fn>;
let unsubscribeMock: ReturnType<typeof vi.fn>;

function createRuntime() {
  return {
    applyGatewayEvent: vi.fn(() => []),
  } as unknown as ChatRuntime;
}

function liveChatEvent(runId = 'run-1'): AdapterGatewayEvent {
  return {
    type: 'event',
    event: 'chat',
    payload: {
      state: 'started',
      sessionKey: 'agent:main:main',
      runId,
    },
  };
}

function emitGatewayEvent(event: AdapterGatewayEvent): void {
  for (const listener of [...gatewayListeners]) listener(event);
}

beforeEach(() => {
  vi.resetModules();
  gatewayListeners = [];
  unsubscribeMock = vi.fn(() => {
    gatewayListeners = [];
  });
  subscribeGatewayEventsMock = vi.fn((listener: GatewayListener) => {
    gatewayListeners.push(listener);
    return unsubscribeMock;
  });
  gatewayRpcCallMock = vi.fn();

  vi.doMock('../gateway-rpc.js', () => ({
    gatewayRpcCall: gatewayRpcCallMock,
    subscribeGatewayEvents: subscribeGatewayEventsMock,
  }));
});

describe('startChatRuntimeGatewaySupervisor', () => {
  it('forwards gateway events to the runtime', async () => {
    const { startChatRuntimeGatewaySupervisor } = await import('./supervisor.js');
    const runtime = createRuntime();
    const event = liveChatEvent();

    startChatRuntimeGatewaySupervisor(runtime);
    emitGatewayEvent(event);

    expect(subscribeGatewayEventsMock).toHaveBeenCalledTimes(1);
    expect(runtime.applyGatewayEvent).toHaveBeenCalledWith(event);
  });

  it('catches runtime errors so later events still flow', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { startChatRuntimeGatewaySupervisor } = await import('./supervisor.js');
    const runtime = createRuntime();
    vi.mocked(runtime.applyGatewayEvent)
      .mockImplementationOnce(() => {
        throw new Error('adapter failed');
      })
      .mockReturnValue([]);

    startChatRuntimeGatewaySupervisor(runtime);
    emitGatewayEvent(liveChatEvent('run-1'));
    emitGatewayEvent(liveChatEvent('run-2'));

    expect(runtime.applyGatewayEvent).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('stops forwarding after idempotent cleanup', async () => {
    const { startChatRuntimeGatewaySupervisor } = await import('./supervisor.js');
    const runtime = createRuntime();
    const stop = startChatRuntimeGatewaySupervisor(runtime);

    emitGatewayEvent(liveChatEvent('run-1'));
    stop();
    stop();
    emitGatewayEvent(liveChatEvent('run-2'));

    expect(runtime.applyGatewayEvent).toHaveBeenCalledTimes(1);
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate subscriptions for the same runtime', async () => {
    const { startChatRuntimeGatewaySupervisor } = await import('./supervisor.js');
    const runtime = createRuntime();

    const stopFirst = startChatRuntimeGatewaySupervisor(runtime);
    const stopSecond = startChatRuntimeGatewaySupervisor(runtime);
    emitGatewayEvent(liveChatEvent());
    stopFirst();
    stopSecond();

    expect(subscribeGatewayEventsMock).toHaveBeenCalledTimes(1);
    expect(runtime.applyGatewayEvent).toHaveBeenCalledTimes(1);
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });
});

describe('getChatRuntime supervisor wiring', () => {
  it('registers lazily and only once for the singleton runtime', async () => {
    const singleton = await import('./singleton.js');

    expect(subscribeGatewayEventsMock).not.toHaveBeenCalled();
    const first = singleton.getChatRuntime();
    const second = singleton.getChatRuntime();

    expect(first).toBe(second);
    expect(subscribeGatewayEventsMock).toHaveBeenCalledTimes(1);
  });
});
