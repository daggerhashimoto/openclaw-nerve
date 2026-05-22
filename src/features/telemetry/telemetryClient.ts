interface BranchSwitchProperties {
  success: boolean;
}

type UiTelemetryEvent =
  | { event: 'session_opened' }
  | { event: 'branch_created' }
  | { event: 'branch_switched'; properties: BranchSwitchProperties };

async function postTelemetryEvent(payload: UiTelemetryEvent): Promise<void> {
  await fetch('/api/telemetry/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export async function emitSessionOpened(): Promise<void> {
  await postTelemetryEvent({ event: 'session_opened' });
}

export async function emitBranchCreated(): Promise<void> {
  await postTelemetryEvent({ event: 'branch_created' });
}

export async function emitBranchSwitched(properties: BranchSwitchProperties): Promise<void> {
  await postTelemetryEvent({ event: 'branch_switched', properties });
}
