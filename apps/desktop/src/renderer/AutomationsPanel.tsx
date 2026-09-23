/**
 * WIRING.md — App.tsx
 * - import { AutomationsPanel } from './AutomationsPanel.js'
 * - import { listAutomations, triggerAutomation, pauseAutomation, resumeAutomation } from './api.js'
 * - Mount as an activity panel (e.g. tab "automations"):
 *   <AutomationsPanel specs={…} runs={…} loading={…} error={…}
 *     onRefresh={…} onTrigger={…} onPause={…} onResume={…} />
 * - Refresh via listAutomations({ baseUrl, token }); wire trigger/pause/resume
 *   to the matching api helpers.
 */

export interface AutomationSpecView {
  specId: string;
  title: string;
  enabled: boolean;
  triggerKind: string;
  scheduleExpr?: string | null;
  eventType?: string | null;
  nextRunAt?: string | null;
  autonomyPreset?: string | null;
}

export interface AutomationRunView {
  runId: string;
  specId: string;
  status: string;
  createdAt: string;
  error?: string | null;
}

export interface AutomationsPanelProps {
  specs: AutomationSpecView[];
  runs: AutomationRunView[];
  loading?: boolean;
  error?: string | null;
  onRefresh: () => void;
  onTrigger: (specId: string) => void;
  onPause: (specId: string) => void;
  onResume: (specId: string) => void;
}

export function AutomationsPanel(props: AutomationsPanelProps) {
  const {
    specs,
    runs,
    loading,
    error,
    onRefresh,
    onTrigger,
    onPause,
    onResume,
  } = props;

  return (
    <div className="automations-panel">
      <header className="automations-panel__header">
        <div>
          <h2 className="automations-panel__title">Automations</h2>
          <p className="automations-panel__subtitle">
            Schedules and runs from the local automation DB
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error ? <p className="automations-panel__error">{error}</p> : null}

      <section className="automations-panel__section">
        <h3 className="automations-panel__section-title">
          Schedules ({specs.length})
        </h3>
        {specs.length === 0 ? (
          <p className="automations-panel__empty">
            No schedules. Create with <code>mitii schedule create</code> or add{' '}
            <code>.mitii/cron/*.cron.md</code>.
          </p>
        ) : (
          <ul className="automations-panel__list">
            {specs.map((spec) => (
              <li key={spec.specId} className="automations-panel__item">
                <div className="automations-panel__item-title">
                  {spec.title}{' '}
                  <span className="automations-panel__muted">
                    ({spec.enabled ? 'on' : 'paused'})
                  </span>
                </div>
                <div className="automations-panel__muted">
                  {spec.triggerKind}
                  {spec.scheduleExpr ? ` · ${spec.scheduleExpr}` : ''}
                  {spec.eventType ? ` · ${spec.eventType}` : ''}
                  {spec.nextRunAt ? ` · next ${spec.nextRunAt}` : ''}
                </div>
                <div className="automations-panel__item-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onTrigger(spec.specId)}
                  >
                    Trigger
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      spec.enabled
                        ? onPause(spec.specId)
                        : onResume(spec.specId)
                    }
                  >
                    {spec.enabled ? 'Pause' : 'Resume'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="automations-panel__section">
        <h3 className="automations-panel__section-title">
          Recent runs ({runs.length})
        </h3>
        {runs.length === 0 ? (
          <p className="automations-panel__empty">No runs yet.</p>
        ) : (
          <ul className="automations-panel__list">
            {runs.map((run) => (
              <li key={run.runId} className="automations-panel__item mono">
                {run.status} · {run.runId.slice(0, 16)}… · {run.createdAt}
                {run.error ? (
                  <div className="automations-panel__error">{run.error}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
