/**
 * Activate a saved connection (webhook secret, local git hook).
 * Not shown on the flow canvas — runner details only.
 */

import { useMemo, useState } from 'react';

export type ConnectionId =
  | 'github'
  | 'slack'
  | 'discord'
  | 'telegram'
  | 'webhook'
  | 'mcp'
  | 'local_git';

const CONNECTION_CATALOG: Array<{
  id: ConnectionId;
  title: string;
  description: string;
  secretFields: Array<{ key: string; label: string; placeholder?: string }>;
}> = [
  {
    id: 'github',
    title: 'GitHub',
    description: 'Webhook HMAC secret',
    secretFields: [
      {
        key: 'webhookSecret',
        label: 'Webhook secret',
        placeholder: 'whsec_…',
      },
    ],
  },
  {
    id: 'local_git',
    title: 'Local git',
    description: 'Install the post-commit hook',
    secretFields: [],
  },
  {
    id: 'webhook',
    title: 'Webhook',
    description: 'Outbound delivery URL',
    secretFields: [{ key: 'url', label: 'Webhook URL' }],
  },
  {
    id: 'slack',
    title: 'Slack',
    description: 'Bot token',
    secretFields: [{ key: 'token', label: 'Bot token' }],
  },
  {
    id: 'discord',
    title: 'Discord',
    description: 'Webhook URL',
    secretFields: [{ key: 'webhookUrl', label: 'Webhook URL' }],
  },
  {
    id: 'telegram',
    title: 'Telegram',
    description: 'Bot token',
    secretFields: [{ key: 'token', label: 'Bot token' }],
  },
  {
    id: 'mcp',
    title: 'MCP',
    description: 'Mark MCP available',
    secretFields: [],
  },
];

export interface ActivateModuleModalProps {
  connectionId: ConnectionId;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onActivate: (input: {
    id: ConnectionId;
    secrets: Record<string, string>;
  }) => void;
  onInstallLocalGit?: () => void;
}

export function ActivateModuleModal(props: ActivateModuleModalProps) {
  const {
    connectionId,
    busy,
    error,
    onCancel,
    onActivate,
    onInstallLocalGit,
  } = props;

  const catalog = useMemo(
    () => CONNECTION_CATALOG.find((c) => c.id === connectionId),
    [connectionId],
  );

  const [values, setValues] = useState<Record<string, string>>({});

  if (!catalog) {
    return (
      <div className="activate-modal" role="dialog" aria-modal>
        <div className="activate-modal__card">
          <h3>Unknown connection</h3>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const isLocalGit = connectionId === 'local_git';
  const isMcp = connectionId === 'mcp';

  return (
    <div className="activate-modal" role="dialog" aria-modal>
      <div className="activate-modal__card">
        <h3 className="activate-modal__title">Activate {catalog.title}</h3>
        <p className="activate-modal__desc">{catalog.description}</p>

        {isLocalGit ? (
          <p className="automations-panel__muted">
            Installing the Mitii post-commit hook activates local git events
            (<code>git.commit.local</code>).
          </p>
        ) : null}

        {isMcp ? (
          <p className="automations-panel__muted">
            MCP servers are configured under Desktop → MCP. Activating marks
            MCP steps as available on the palette.
          </p>
        ) : null}

        {catalog.secretFields.map((field) => (
          <label key={field.key} className="flow-inspector__label">
            {field.label}
            <input
              className="flow-inspector__input"
              type={
                field.key.toLowerCase().includes('token') ||
                field.key.toLowerCase().includes('secret')
                  ? 'password'
                  : 'text'
              }
              autoComplete="off"
              placeholder={field.placeholder}
              value={values[field.key] ?? ''}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
              }
            />
          </label>
        ))}

        {error ? <p className="automations-panel__error">{error}</p> : null}

        <div className="activate-modal__actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          {isLocalGit && onInstallLocalGit ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => onInstallLocalGit()}
            >
              {busy ? 'Installing…' : 'Install git hook'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                onActivate({
                  id: connectionId,
                  secrets: values,
                })
              }
            >
              {busy ? 'Saving…' : 'Activate'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
