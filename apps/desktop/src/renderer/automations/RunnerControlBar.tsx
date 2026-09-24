/**
 * Compact local runner start/stop — always visible on Automations home.
 */

import type { AutomationRunnerView } from './AutomationsPanel.js';

export interface RunnerControlBarProps {
  runner?: AutomationRunnerView | null;
  busy?: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function RunnerControlBar(props: RunnerControlBarProps) {
  const { runner, busy, onStart, onStop } = props;
  const running = Boolean(runner?.running);

  return (
    <div className="runner-control-bar" role="status">
      <div className="runner-control-bar__status">
        <span
          className={
            running
              ? 'automations-runner__dot automations-runner__dot--on'
              : 'automations-runner__dot automations-runner__dot--off'
          }
          aria-hidden
        />
        <div>
          <div className="runner-control-bar__label">
            {running ? 'Runner active' : 'Runner stopped'}
          </div>
          <div className="automations-panel__muted">
            {running
              ? runner?.webhookPort
                ? `Webhook :${runner.webhookPort} · claim/lease loop`
                : 'Claim/lease loop (no webhook port)'
              : 'Start to process schedules, events, and manual triggers'}
          </div>
          {runner?.lastError ? (
            <div className="automations-panel__error">{runner.lastError}</div>
          ) : null}
        </div>
      </div>
      <div className="runner-control-bar__actions">
        {running ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={onStop}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={onStart}
          >
            Start
          </button>
        )}
      </div>
    </div>
  );
}
