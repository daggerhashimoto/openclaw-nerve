import { Pane } from '@/components/ui/Pane';
import { runStateLabel } from '../utils';

interface HeartbeatPulseProps {
  lastEventTimestamp: number;
  stage?: 'thinking' | 'tool_use' | 'streaming' | null;
}

/**
 * Proof of life during agent processing: a lit live pane, named for the stage.
 * It switches on while the agent works; it never pulses.
 */
export function HeartbeatPulse({ stage }: HeartbeatPulseProps) {
  return <Pane state="live" size="sm" label={runStateLabel(stage)} />;
}
