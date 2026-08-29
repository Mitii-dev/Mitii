import type { IndexStatusSnapshot } from '../protocol';

interface OnboardingPanelProps {
  index: IndexStatusSnapshot;
  onIndex: () => void;
  onComplete: () => void;
  onOpenSettings: () => void;
}

export function OnboardingPanel({
  index,
  onIndex,
  onComplete,
  onOpenSettings,
}: OnboardingPanelProps) {
  const indexing =
    index.readiness === 'indexing' ||
    index.readiness === 'pending' ||
    (index.message ?? '').toLowerCase().includes('indexing') ||
    (index.message ?? '').toLowerCase().includes('checking');
  const indexed = index.fileCount > 0 && !indexing;
  const indexMessage = indexing
    ? (index.message ?? 'Indexing workspace…')
    : indexed
      ? `Indexed ${index.fileCount} file${index.fileCount === 1 ? '' : 's'}${index.readiness ? ` · ${index.readiness}` : ''}.`
      : 'Build the local index so Ask, Plan, Agent, and Review have useful repository context.';

  return (
    <section className="onboarding" aria-label="First run setup">
      <div className="onboarding__header">
        <div>
          <h2 className="onboarding__title">Set up Mitii</h2>
          <p className="onboarding__subtitle">
            Configure a provider, index this workspace, then start chatting.
          </p>
        </div>
        <button type="button" className="btn ghost" onClick={onComplete}>
          Skip
        </button>
      </div>

      <div className="onboarding__body">
        <h3>1. Provider</h3>
        <p>
          Open Settings → Provider to pick Echo (local stub), Ollama / LM Studio, or
          another OpenAI-compatible endpoint. Local models do not need an API key.
        </p>
        <button type="button" className="btn ghost" onClick={onOpenSettings}>
          Open provider settings
        </button>
      </div>

      <div className="onboarding__body">
        <h3>2. Index workspace</h3>
        <p>{indexMessage}</p>
        <div className="row">
          <button
            type="button"
            className="btn ghost"
            onClick={onIndex}
            disabled={indexing}
          >
            {indexing ? 'Indexing…' : indexed ? 'Reindex' : 'Index workspace'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={onComplete}
            disabled={indexing}
          >
            {indexed ? 'Start chatting' : 'Complete'}
          </button>
        </div>
      </div>
    </section>
  );
}
