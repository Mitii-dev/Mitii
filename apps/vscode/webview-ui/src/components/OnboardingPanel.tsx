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
  const indexed = index.fileCount > 0;

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
          Open Settings → Model to pick Echo (local stub), Ollama / LM Studio, or
          another OpenAI-compatible endpoint. Set an API key when needed.
        </p>
        <button type="button" className="btn ghost" onClick={onOpenSettings}>
          Open model settings
        </button>
      </div>

      <div className="onboarding__body">
        <h3>2. Index workspace</h3>
        <p>
          {indexed
            ? `Indexed ${index.fileCount} item${index.fileCount === 1 ? '' : 's'}${index.readiness ? ` · ${index.readiness}` : ''}.`
            : 'Build the local index so Ask, Plan, Agent, and Review have useful repository context.'}
        </p>
        <div className="row">
          <button type="button" className="btn ghost" onClick={onIndex}>
            Index workspace
          </button>
          <button type="button" className="btn" onClick={onComplete}>
            Complete
          </button>
        </div>
      </div>
    </section>
  );
}
