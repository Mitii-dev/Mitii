import { postToHost } from '../bridge';
import type {
  AutomationRunView,
  AutomationSpecView,
} from '../protocol';

export interface AutomationsPanelProps {
  specs: AutomationSpecView[];
  runs: AutomationRunView[];
  loading?: boolean;
  error?: string | null;
  onRefresh: () => void;
}

/**
 * Phase 5 — Automations control surface (schedules + recent runs).
 */
export function AutomationsPanel(props: AutomationsPanelProps) {
  const { specs, runs, loading, error, onRefresh } = props;

  return (
    <div className="automations-panel" style={{ padding: '12px 16px' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Automations</h2>
          <p style={{ margin: '4px 0 0', opacity: 0.7, fontSize: 12 }}>
            Schedules and runs from the local automation DB
          </p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error ? (
        <p style={{ color: 'var(--vscode-errorForeground)' }}>{error}</p>
      ) : null}

      <section style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 13, marginBottom: 8 }}>Schedules ({specs.length})</h3>
        {specs.length === 0 ? (
          <p style={{ opacity: 0.6, fontSize: 12 }}>
            No schedules. Create with{' '}
            <code>mitii schedule create</code> or add{' '}
            <code>.mitii/cron/*.cron.md</code>.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {specs.map((spec) => (
              <li
                key={spec.specId}
                style={{
                  borderTop: '1px solid var(--vscode-widget-border)',
                  padding: '8px 0',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {spec.title}{' '}
                  <span style={{ opacity: 0.6 }}>
                    ({spec.enabled ? 'on' : 'paused'})
                  </span>
                </div>
                <div style={{ opacity: 0.75 }}>
                  {spec.triggerKind}
                  {spec.scheduleExpr ? ` · ${spec.scheduleExpr}` : ''}
                  {spec.eventType ? ` · ${spec.eventType}` : ''}
                  {spec.nextRunAt ? ` · next ${spec.nextRunAt}` : ''}
                </div>
                <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() =>
                      postToHost({
                        type: 'automation.trigger',
                        specId: spec.specId,
                      })
                    }
                  >
                    Trigger
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      postToHost({
                        type: spec.enabled
                          ? 'automation.pause'
                          : 'automation.resume',
                        specId: spec.specId,
                      })
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

      <section>
        <h3 style={{ fontSize: 13, marginBottom: 8 }}>Recent runs ({runs.length})</h3>
        {runs.length === 0 ? (
          <p style={{ opacity: 0.6, fontSize: 12 }}>No runs yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {runs.map((run) => (
              <li
                key={run.runId}
                style={{
                  borderTop: '1px solid var(--vscode-widget-border)',
                  padding: '6px 0',
                  fontSize: 12,
                  fontFamily: 'var(--vscode-editor-font-family)',
                }}
              >
                {run.status} · {run.runId.slice(0, 16)}… · {run.createdAt}
                {run.error ? (
                  <div style={{ color: 'var(--vscode-errorForeground)' }}>
                    {run.error}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
