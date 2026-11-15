import type { ProcessingStage } from '@/contexts/ChatContext';
import { runStateLabel } from '../utils';

interface ThinkingDotsProps {
  stage?: ProcessingStage;
}

/**
 * Plain run-state text for the processing indicator ("Thinking", "Running",
 * "Writing"). Replaces the old animated dots: state is said, not bounced.
 */
export function ThinkingDots({ stage }: ThinkingDotsProps) {
  return <span className="text-live-text">{runStateLabel(stage)}</span>;
}
