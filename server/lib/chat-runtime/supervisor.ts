import { subscribeGatewayEvents } from '../gateway-rpc.js';
import type { ChatRuntime } from './runtime.js';

interface SupervisorHandle {
  stop: () => void;
}

const supervisors = new WeakMap<ChatRuntime, SupervisorHandle>();

export function startChatRuntimeGatewaySupervisor(runtime: ChatRuntime): () => void {
  const existing = supervisors.get(runtime);
  if (existing) return existing.stop;

  let stopped = false;
  const unsubscribe = subscribeGatewayEvents((event) => {
    try {
      runtime.applyGatewayEvent(event);
    } catch (err) {
      console.warn('[chat-runtime] Failed to apply gateway event:', err);
    }
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    supervisors.delete(runtime);
    unsubscribe();
  };

  supervisors.set(runtime, { stop });
  return stop;
}
