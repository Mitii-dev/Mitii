import type { AgentUiMode } from '../protocol';

interface ModeIndicatorProps {
  mode: AgentUiMode;
  onChange: (mode: AgentUiMode) => void;
}

const MODES: { id: AgentUiMode; label: string; description: string }[] = [
  { id: 'ask', label: 'Ask', description: 'Explore and answer — read-only' },
  { id: 'plan', label: 'Plan', description: 'Analyze and propose a structured plan' },
  { id: 'agent', label: 'Agent', description: 'Implement with controlled execution' },
  { id: 'review', label: 'Review', description: 'Inspect diffs and provide findings' },
];

export function ModeIndicator({ mode, onChange }: ModeIndicatorProps) {
  return (
    <div className="mode-switch" role="tablist" aria-label="Agent mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          className={`mode-btn ${mode === m.id ? 'active' : ''}`}
          onClick={() => onChange(m.id)}
          title={m.description}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

export const MODE_HINT: Record<AgentUiMode, string> = {
  ask: 'Explore and answer — read-only.',
  plan: 'Analyze and propose a structured plan.',
  agent: 'Implement changes with controlled execution.',
  review: 'Inspect working-tree diffs and report findings.',
};
