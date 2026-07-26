import type { ContextToggles } from '../protocol';

interface ContextTogglesPanelProps {
  toggles: ContextToggles;
  onToggle: (source: keyof ContextToggles, enabled: boolean) => void;
}

const TOGGLE_LABELS: Record<keyof ContextToggles, string> = {
  repoMap: 'Repo map',
  diagnostics: 'Diagnostics',
  gitDiff: 'Git diff',
  editor: 'Active editor',
  openTabs: 'Open tabs',
  memory: 'Memory',
};

export function ContextTogglesPanel({
  toggles,
  onToggle,
}: ContextTogglesPanelProps) {
  return (
    <div className="context-toggles">
      {(Object.keys(TOGGLE_LABELS) as Array<keyof ContextToggles>).map((key) => (
        <label key={key} className="toggle">
          <input
            type="checkbox"
            checked={toggles[key]}
            onChange={(e) => onToggle(key, e.target.checked)}
          />
          {TOGGLE_LABELS[key]}
        </label>
      ))}
    </div>
  );
}
