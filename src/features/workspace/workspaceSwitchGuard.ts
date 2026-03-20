import { getWorkspaceAgentId } from './workspaceScope';

export function shouldGuardWorkspaceSwitch(
  currentSessionKey: string,
  nextSessionKey: string,
  hasDirtyFiles: boolean,
): boolean {
  if (!hasDirtyFiles) return false;
  return getWorkspaceAgentId(currentSessionKey) !== getWorkspaceAgentId(nextSessionKey);
}
