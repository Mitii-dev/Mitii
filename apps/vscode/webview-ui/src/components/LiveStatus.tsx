import type { ActivityEventPayload } from '../protocol';

export type LiveStatusPhase =
  | 'thinking'
  | 'reading'
  | 'planning'
  | 'command'
  | 'changing'
  | 'summarizing';

export const LIVE_STATUS_PHRASES: Record<LiveStatusPhase, string> = {
  thinking: 'Brainstorming',
  reading: 'Reading workspace',
  planning: 'Planning next step',
  command: 'Running command',
  changing: 'Applying changes',
  summarizing: 'Preparing response',
};

export function derivePhase(event: ActivityEventPayload | undefined): LiveStatusPhase {
  if (!event) return 'thinking';
  if (event.kind === 'thinking') return 'thinking';
  const title = event.title.toLowerCase();
  if (/summar/.test(title)) return 'summarizing';
  if (/plan/.test(title)) return 'planning';
  if (/command|run_/.test(title)) return 'command';
  if (/write|edit|patch|apply|delete|create|mutat/.test(title)) {
    return 'changing';
  }
  if (/read|search|glob|grep|diagnostic|list/.test(title)) return 'reading';
  return 'thinking';
}

interface LiveStatusProps {
  phase: LiveStatusPhase;
}

export function LiveStatus({ phase }: LiveStatusProps) {
  return (
    <div className="live-status" role="status" aria-live="polite">
      <span className="live-status__dot" aria-hidden="true" />
      <span className="live-status__text" key={phase}>
        {LIVE_STATUS_PHRASES[phase]}
      </span>
      <span className="live-status__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
