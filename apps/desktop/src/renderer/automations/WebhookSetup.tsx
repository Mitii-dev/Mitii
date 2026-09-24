/**
 * GitHub / webhook ingress + local git hook setup.
 */

import type { AutomationRunnerView } from './AutomationsPanel.js';

export interface GitHookView {
  installed: boolean;
  path: string;
  managedByMitii: boolean;
  version: string | null;
  eventsUrl: string | null;
}

export interface WebhookSetupProps {
  runner: AutomationRunnerView | null | undefined;
  webhookPort: number;
  webhookToken: string;
  githubWebhookSecret: string;
  installGitHook: boolean;
  gitHook?: GitHookView | null;
  onWebhookPortChange: (port: number) => void;
  onWebhookTokenChange: (token: string) => void;
  onGithubSecretChange: (secret: string) => void;
  onInstallGitHookChange: (value: boolean) => void;
  onStart: () => void;
  onStop: () => void;
  onInstallHook?: () => void;
  onUninstallHook?: () => void;
  events?: Array<{
    eventId: string;
    eventType: string;
    source: string;
    processingStatus: string;
    occurredAt: string;
    matchedSpecCount: number;
    queuedRunCount: number;
  }>;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

export function WebhookSetup(props: WebhookSetupProps) {
  const {
    runner,
    webhookPort,
    webhookToken,
    githubWebhookSecret,
    installGitHook,
    gitHook,
    onWebhookPortChange,
    onWebhookTokenChange,
    onGithubSecretChange,
    onInstallGitHookChange,
    onStart,
    onStop,
    onInstallHook,
    onUninstallHook,
    events = [],
  } = props;

  const githubUrl = runner?.hooks?.github ?? null;
  const eventsUrl = runner?.hooks?.events ?? null;

  return (
    <section className="webhook-setup">
      <h3 className="automations-panel__section-title">
        Webhook ingress &amp; runner
      </h3>
      <p className="automations-panel__muted">
        Control-plane HTTP surface (same as{' '}
        <code>mitii serve --webhook-port</code>). Point a GitHub repository
        webhook at the GitHub path with HMAC secret — activate the GitHub
        module above first.
      </p>

      <div className="webhook-setup__grid">
        <label className="flow-inspector__label">
          Port
          <input
            className="flow-inspector__input"
            type="number"
            value={webhookPort}
            disabled={runner?.running}
            onChange={(e) => onWebhookPortChange(Number(e.target.value) || 0)}
          />
        </label>
        <label className="flow-inspector__label">
          Bearer token (optional)
          <input
            className="flow-inspector__input"
            type="password"
            autoComplete="off"
            value={webhookToken}
            disabled={runner?.running}
            placeholder="X-Mitii-Token / Authorization"
            onChange={(e) => onWebhookTokenChange(e.target.value)}
          />
        </label>
        <label className="flow-inspector__label">
          GitHub webhook secret
          <input
            className="flow-inspector__input"
            type="password"
            autoComplete="off"
            value={githubWebhookSecret}
            disabled={runner?.running}
            placeholder="X-Hub-Signature-256"
            onChange={(e) => onGithubSecretChange(e.target.value)}
          />
        </label>
      </div>

      <label className="flow-inspector__check">
        <input
          type="checkbox"
          checked={installGitHook}
          onChange={(e) => onInstallGitHookChange(e.target.checked)}
        />
        Install local <code>post-commit</code> hook on start (
        <code>git.commit.local</code>)
      </label>

      <div className="webhook-setup__actions">
        {runner?.running ? (
          <button type="button" className="btn btn-ghost" onClick={onStop}>
            Stop runner
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onStart}>
            Start runner + webhook
          </button>
        )}
        {gitHook?.managedByMitii ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onUninstallHook?.()}
          >
            Uninstall git hook
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onInstallHook?.()}
          >
            Install git hook now
          </button>
        )}
      </div>

      {gitHook ? (
        <p className="automations-panel__muted">
          Git hook: {gitHook.installed ? 'installed' : 'not installed'}
          {gitHook.managedByMitii ? ' (Mitii-managed)' : ''}
          {gitHook.version ? ` · v${gitHook.version}` : ''}
        </p>
      ) : null}

      {runner?.running ? (
        <div className="webhook-setup__urls">
          <div className="webhook-setup__url-row">
            <code>{githubUrl ?? 'GitHub hook unavailable'}</code>
            {githubUrl ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void copyText(githubUrl)}
              >
                Copy
              </button>
            ) : null}
          </div>
          <div className="webhook-setup__url-row">
            <code>{eventsUrl ?? 'Events hook unavailable'}</code>
            {eventsUrl ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void copyText(eventsUrl)}
              >
                Copy
              </button>
            ) : null}
          </div>
          <ul className="webhook-setup__checklist">
            <li>
              Secret configured:{' '}
              {runner.githubWebhookSecretSet
                ? 'yes'
                : 'no (unsigned rejected if set)'}
            </li>
            <li>
              Bearer token: {runner.webhookTokenSet ? 'yes' : 'optional / unset'}
            </li>
            <li>
              GitHub events: <code>push</code>, <code>workflow_run</code>,{' '}
              <code>pull_request</code>
            </li>
            <li>
              Prefs saved under <code>.mitii/desktop-runner.json</code> (secrets
              in <code>.mitii/desktop-runner.secrets.json</code> — do not commit)
            </li>
          </ul>
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="webhook-setup__events">
          <h4>Recent ingress</h4>
          <ul className="automations-panel__list">
            {events.map((e) => (
              <li key={e.eventId} className="automations-panel__item mono">
                {e.processingStatus} · {e.eventType} · matched{' '}
                {e.matchedSpecCount} · queued {e.queuedRunCount} ·{' '}
                {e.occurredAt}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
