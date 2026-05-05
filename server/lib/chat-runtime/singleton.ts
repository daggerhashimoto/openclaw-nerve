import { gatewayRpcCall } from '../gateway-rpc.js';
import { ChatRuntime, type ChatRuntimeRpc } from './runtime.js';
import { startChatRuntimeGatewaySupervisor } from './supervisor.js';

const DEFAULT_MAX_PATCHES_PER_SESSION = 1_000;
const MAX_PATCHES_PER_SESSION_LIMIT = 10_000;
const MAX_PATCHES_ENV = 'NERVE_CHAT_RUNTIME_MAX_PATCHES';

let runtime: ChatRuntime | undefined;

export function getChatRuntime(): ChatRuntime {
  if (!runtime) {
    runtime = new ChatRuntime({
      rpc: gatewayRpcCall as ChatRuntimeRpc,
      maxPatchesPerSession: getMaxPatchesPerSession(),
    });
    startChatRuntimeGatewaySupervisor(runtime);
  }

  return runtime;
}

function getMaxPatchesPerSession(): number {
  const raw = process.env[MAX_PATCHES_ENV]?.trim();
  if (!raw) return DEFAULT_MAX_PATCHES_PER_SESSION;
  if (!/^\d+$/.test(raw)) return DEFAULT_MAX_PATCHES_PER_SESSION;

  const parsed = Number(raw);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > MAX_PATCHES_PER_SESSION_LIMIT
  ) {
    return DEFAULT_MAX_PATCHES_PER_SESSION;
  }

  return parsed;
}
