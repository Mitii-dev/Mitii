/**
 * Enterprise-style Database MCP install form.
 * Chooses connection method first (URI vs fields), then shows only relevant inputs.
 */

import type { CatalogSecretField } from './mcpCatalogTypes.js';

export type DbConnectMethod = 'uri' | 'fields';

interface Props {
  builtinId: string;
  fields: CatalogSecretField[];
  draft: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  method: DbConnectMethod;
  onMethodChange: (method: DbConnectMethod) => void;
}

const URI_KEYS = new Set(['DATABASE_URI', 'MCP_MONGODB_URI', 'SQL_MCP_URI']);

function isSqliteOnly(builtinId: string): boolean {
  return builtinId === 'sqlite';
}

function dialectOf(draft: Record<string, string>): string {
  return (draft.SQL_MCP_DIALECT ?? '').trim().toLowerCase();
}

function visibleFieldKeys(
  builtinId: string,
  method: DbConnectMethod,
  draft: Record<string, string>,
): Set<string> | 'all' {
  if (isSqliteOnly(builtinId)) {
    return new Set(['SQLITE_PATH']);
  }

  if (builtinId === 'sql') {
    const dialect = dialectOf(draft);
    if (method === 'uri') {
      return new Set(['SQL_MCP_DIALECT', 'SQL_MCP_URI']);
    }
    if (dialect === 'sqlite' || dialect === 'sqlite3') {
      return new Set(['SQL_MCP_DIALECT', 'MITII_DB_PATH']);
    }
    return new Set([
      'SQL_MCP_DIALECT',
      'MITII_DB_HOST',
      'MITII_DB_PORT',
      'MITII_DB_USER',
      'MITII_DB_PASSWORD',
      'MITII_DB_NAME',
    ]);
  }

  if (method === 'uri') {
    if (builtinId === 'postgres') return new Set(['DATABASE_URI']);
    if (builtinId === 'mongo') return new Set(['MCP_MONGODB_URI']);
    return 'all';
  }

  return new Set([
    'MITII_DB_HOST',
    'MITII_DB_PORT',
    'MITII_DB_USER',
    'MITII_DB_PASSWORD',
    'MITII_DB_NAME',
  ]);
}

function fieldByKey(
  fields: CatalogSecretField[],
  key: string,
): CatalogSecretField | undefined {
  return fields.find((f) => f.key === key);
}

function MethodToggle(props: {
  method: DbConnectMethod;
  onChange: (m: DbConnectMethod) => void;
}): React.ReactElement {
  return (
    <div className="mcp-db-form__methods" role="tablist" aria-label="Connection method">
      <button
        type="button"
        role="tab"
        aria-selected={props.method === 'uri'}
        className={`mcp-db-form__method${props.method === 'uri' ? ' is-active' : ''}`}
        onClick={() => props.onChange('uri')}
      >
        Connection string
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={props.method === 'fields'}
        className={`mcp-db-form__method${props.method === 'fields' ? ' is-active' : ''}`}
        onClick={() => props.onChange('fields')}
      >
        Host &amp; credentials
      </button>
    </div>
  );
}

function FieldInput(props: {
  field: CatalogSecretField;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}): React.ReactElement {
  const { field } = props;
  const requiredMark =
    field.required !== false ? (
      <span className="mcp-db-form__req" aria-hidden>
        *
      </span>
    ) : (
      <span className="mcp-db-form__opt">Optional</span>
    );

  return (
    <label className="mcp-db-form__field">
      <span className="mcp-db-form__label">
        {field.label}
        {requiredMark}
      </span>
      {props.multiline ? (
        <textarea
          rows={3}
          value={props.value}
          placeholder={field.placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => props.onChange(e.target.value)}
        />
      ) : (
        <input
          type={field.secret ? 'password' : 'text'}
          value={props.value}
          placeholder={field.placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
      {field.hint ? (
        <span className="mcp-db-form__hint">{field.hint}</span>
      ) : null}
    </label>
  );
}

export function DatabaseMcpSecretsForm(props: Props): React.ReactElement {
  const { builtinId, fields, draft, onChange, method, onMethodChange } = props;
  const sqliteOnly = isSqliteOnly(builtinId);
  const keys = visibleFieldKeys(builtinId, method, draft);

  const setKey = (key: string, value: string) => {
    onChange({ ...draft, [key]: value });
  };

  const renderKey = (key: string, multiline = false) => {
    const field = fieldByKey(fields, key);
    if (!field) return null;
    return (
      <FieldInput
        key={key}
        field={field}
        value={draft[key] ?? ''}
        multiline={multiline}
        onChange={(v) => setKey(key, v)}
      />
    );
  };

  if (sqliteOnly) {
    return (
      <div className="mcp-db-form">
        <p className="mcp-db-form__intro">
          Point Mitii at a SQLite file on disk. No username or password.
        </p>
        {renderKey('SQLITE_PATH')}
      </div>
    );
  }

  const showUri = method === 'uri';
  const dialect = dialectOf(draft);
  const sqlSqliteFields =
    builtinId === 'sql' &&
    method === 'fields' &&
    (dialect === 'sqlite' || dialect === 'sqlite3');

  return (
    <div className="mcp-db-form">
      <p className="mcp-db-form__intro">
        {builtinId === 'mongo'
          ? 'Connect with an Atlas / mongodb URI, or enter host credentials separately.'
          : builtinId === 'postgres'
            ? 'Paste a postgresql:// URI, or fill host, user, password, and database.'
            : 'Pick a dialect, then connect with a URI or host credentials.'}
      </p>

      <MethodToggle method={method} onChange={onMethodChange} />

      {builtinId === 'sql' ? (
        <div className="mcp-db-form__grid mcp-db-form__grid--dialect">
          {renderKey('SQL_MCP_DIALECT')}
        </div>
      ) : null}

      {showUri ? (
        <div className="mcp-db-form__stack">
          {builtinId === 'postgres' ? renderKey('DATABASE_URI', true) : null}
          {builtinId === 'mongo' ? renderKey('MCP_MONGODB_URI', true) : null}
          {builtinId === 'sql' ? renderKey('SQL_MCP_URI', true) : null}
        </div>
      ) : sqlSqliteFields ? (
        <div className="mcp-db-form__stack">{renderKey('MITII_DB_PATH')}</div>
      ) : (
        <div className="mcp-db-form__grid">
          {renderKey('MITII_DB_HOST')}
          {renderKey('MITII_DB_PORT')}
          {renderKey('MITII_DB_USER')}
          {renderKey('MITII_DB_PASSWORD')}
          <div className="mcp-db-form__span-2">{renderKey('MITII_DB_NAME')}</div>
        </div>
      )}

      {keys !== 'all'
        ? null
        : fields
            .filter((f) => !URI_KEYS.has(f.key) || showUri)
            .map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={draft[f.key] ?? ''}
                onChange={(v) => setKey(f.key, v)}
              />
            ))}
    </div>
  );
}

/** Validate draft for the active connection method (client-side). */
export function validateDatabaseMcpDraft(
  builtinId: string,
  method: DbConnectMethod,
  draft: Record<string, string>,
): string | null {
  const t = (key: string) => (draft[key] ?? '').trim();

  if (builtinId === 'sqlite') {
    return t('SQLITE_PATH') ? null : 'SQLite database path is required';
  }

  if (method === 'uri') {
    if (builtinId === 'postgres') {
      return t('DATABASE_URI') ? null : 'Connection URI is required';
    }
    if (builtinId === 'mongo') {
      return t('MCP_MONGODB_URI') ? null : 'Connection URI is required';
    }
    if (builtinId === 'sql') {
      if (!t('SQL_MCP_URI')) return 'Connection URI is required';
      return null;
    }
  }

  if (builtinId === 'sql') {
    if (!t('SQL_MCP_DIALECT')) return 'Dialect is required';
    const d = dialectOf(draft);
    if (d === 'sqlite' || d === 'sqlite3') {
      return t('MITII_DB_PATH') ? null : 'SQLite path is required';
    }
    if (!t('MITII_DB_HOST')) return 'Host is required';
    if (!t('MITII_DB_NAME')) return 'Database is required';
    return null;
  }

  if (!t('MITII_DB_HOST')) return 'Host is required';
  if (!t('MITII_DB_NAME')) return 'Database is required';
  return null;
}
