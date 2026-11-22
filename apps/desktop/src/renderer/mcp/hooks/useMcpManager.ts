/**
 * State, reload, and mutations for the MCP manager UI.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  addCustomMcp,
  deleteMcpServer,
  fetchMcpServers,
  installBuiltinMcp,
  setMcpEnabled,
} from '../../api.js';
import {
  validateDatabaseMcpDraft,
  type DbConnectMethod,
} from '../DatabaseMcpSecretsForm.js';
import {
  EMPTY_CUSTOM,
  type CatalogRow,
  type CustomMcpDraft,
  type McpServerRow,
  type McpSnapshot,
  type WizardStep,
} from '../mcpManagerTypes.js';

export interface UseMcpManagerOptions {
  baseUrl: string;
  token?: string;
  onRestartEngine?: () => Promise<void>;
}

const DB_FIELD_KEYS = [
  'SQL_MCP_DIALECT',
  'MITII_DB_HOST',
  'MITII_DB_PORT',
  'MITII_DB_USER',
  'MITII_DB_PASSWORD',
  'MITII_DB_NAME',
  'MITII_DB_PATH',
];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function emptySecretDraft(entry: CatalogRow): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const field of entry.secrets ?? []) draft[field.key] = '';
  return draft;
}

function parseHeaders(text: string): Record<string, string> | undefined {
  if (!text.trim()) return undefined;
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) throw new Error('Headers must be Name: value per line');
    headers[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return headers;
}

/** Only send keys for the chosen method so URI and fields are never mixed. */
function buildDatabasePayload(
  builtinId: string,
  method: DbConnectMethod,
  draft: Record<string, string>,
): Record<string, string> {
  const payload: Record<string, string> = {};
  if (builtinId === 'sqlite') {
    payload.SQLITE_PATH = draft.SQLITE_PATH ?? '';
  } else if (method === 'uri') {
    if (builtinId === 'postgres') {
      payload.DATABASE_URI = draft.DATABASE_URI ?? '';
    } else if (builtinId === 'mongo') {
      payload.MCP_MONGODB_URI = draft.MCP_MONGODB_URI ?? '';
    } else if (builtinId === 'sql') {
      if (draft.SQL_MCP_DIALECT?.trim()) {
        payload.SQL_MCP_DIALECT = draft.SQL_MCP_DIALECT;
      }
      payload.SQL_MCP_URI = draft.SQL_MCP_URI ?? '';
    }
  } else {
    for (const key of DB_FIELD_KEYS) {
      const v = draft[key]?.trim();
      if (v) payload[key] = v;
    }
  }
  return payload;
}

export function useMcpManager(props: UseMcpManagerOptions) {
  const auth = { baseUrl: props.baseUrl, token: props.token };
  const [enabled, setEnabled] = useState(false);
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>('source');
  const [custom, setCustom] = useState<CustomMcpDraft>(EMPTY_CUSTOM);
  const [selectedBuiltin, setSelectedBuiltin] = useState<string | null>(null);
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({});
  const [dbConnectMethod, setDbConnectMethod] =
    useState<DbConnectMethod>('uri');

  const applySnapshot = (next: McpSnapshot) => {
    setEnabled(next.enabled);
    setServers(next.servers);
    if (next.catalog) setCatalog(next.catalog);
  };

  const reload = useCallback(async () => {
    try {
      const next = await fetchMcpServers(auth);
      applySnapshot(next);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [props.baseUrl, props.token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const flash = (message: string) => {
    setNote(message);
    window.setTimeout(() => setNote(null), 1800);
  };

  const afterMutation = async (next: McpSnapshot, message: string) => {
    applySnapshot(next);
    if (next.restartRequired && props.onRestartEngine) {
      await props.onRestartEngine();
      flash(`${message} — engine restarted`);
    } else {
      flash(message);
    }
    await reload();
  };

  const runMutation = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const filteredServers = useMemo(() => {
    if (!q) return servers;
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.transport ?? '').toLowerCase().includes(q),
    );
  }, [servers, q]);

  const availableCatalog = useMemo(() => {
    const list = catalog.filter((c) => !c.installed);
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        (c.category ?? '').toLowerCase().includes(q),
    );
  }, [catalog, q]);

  const selectedCatalogEntry = useMemo(
    () => catalog.find((c) => c.id === selectedBuiltin) ?? null,
    [catalog, selectedBuiltin],
  );

  const openWizard = () => {
    setWizardOpen(true);
    setWizardStep('source');
    setSelectedBuiltin(null);
    setSecretDraft({});
    setCustom({
      ...EMPTY_CUSTOM,
      id: `mcp-${Date.now().toString(36)}`,
      name: 'My MCP server',
    });
    setError(null);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setWizardStep('source');
    setSelectedBuiltin(null);
    setSecretDraft({});
  };

  const toggleMaster = (next: boolean) =>
    runMutation(async () => {
      const result = await setMcpEnabled({ ...auth, enabled: next });
      await afterMutation(result, next ? 'MCP enabled' : 'MCP disabled');
    });

  const toggleServer = (serverId: string, next: boolean) =>
    runMutation(async () => {
      const result = await setMcpEnabled({
        ...auth,
        serverId,
        enabled: next,
      });
      await afterMutation(result, next ? `${serverId} on` : `${serverId} off`);
    });

  const removeServer = async (serverId: string) => {
    if (
      !window.confirm(
        `Remove MCP server “${serverId}” from this workspace?\n\nThis updates .mitii/mcp.json. Built-in servers can be re-added from the catalog.`,
      )
    ) {
      return;
    }
    await runMutation(async () => {
      const result = await deleteMcpServer({ ...auth, serverId });
      await afterMutation(result, `Removed ${serverId}`);
    });
  };

  const installBuiltin = (
    builtinId: string,
    secrets?: Record<string, string>,
  ) =>
    runMutation(async () => {
      const result = await installBuiltinMcp({
        ...auth,
        builtinId,
        ...(secrets ? { secrets } : {}),
      });
      await afterMutation(result, `Installed ${builtinId}`);
      closeWizard();
    });

  const startSecretsStep = (entry: CatalogRow) => {
    setSecretDraft(emptySecretDraft(entry));
    setDbConnectMethod(entry.id === 'sqlite' ? 'fields' : 'uri');
    setWizardStep('catalog-secrets');
  };

  const beginCatalogInstall = (entry: CatalogRow) => {
    setError(null);
    setSelectedBuiltin(entry.id);
    if ((entry.secrets ?? []).length > 0) {
      setWizardOpen(true);
      startSecretsStep(entry);
      return;
    }
    void installBuiltin(entry.id);
  };

  const installSelectedBuiltin = async () => {
    if (!selectedBuiltin) return;
    const entry = catalog.find((c) => c.id === selectedBuiltin);
    if (entry && (entry.secrets?.length ?? 0) > 0) {
      startSecretsStep(entry);
      return;
    }
    await installBuiltin(selectedBuiltin);
  };

  const confirmCatalogSecrets = async () => {
    if (!selectedBuiltin || !selectedCatalogEntry) return;
    const draft = secretDraft;

    if (selectedCatalogEntry.category === 'database') {
      const err = validateDatabaseMcpDraft(
        selectedBuiltin,
        dbConnectMethod,
        draft,
      );
      if (err) {
        setError(err);
        return;
      }
      await installBuiltin(
        selectedBuiltin,
        buildDatabasePayload(selectedBuiltin, dbConnectMethod, draft),
      );
      return;
    }

    for (const field of selectedCatalogEntry.secrets ?? []) {
      if (field.required === false) continue;
      if (!(draft[field.key] ?? '').trim()) {
        setError(`${field.label} is required`);
        return;
      }
    }
    await installBuiltin(selectedBuiltin, secretDraft);
  };

  const createCustom = () =>
    runMutation(async () => {
      const headers = parseHeaders(custom.headersText);
      const args = custom.argsText
        .split(/\s+/)
        .map((v) => v.trim())
        .filter(Boolean);
      const result = await addCustomMcp({
        ...auth,
        id: custom.id,
        name: custom.name,
        transport: custom.transport,
        ...(custom.transport === 'stdio'
          ? {
              command: custom.command,
              ...(args.length ? { args } : {}),
              ...(custom.cwd.trim() ? { cwd: custom.cwd.trim() } : {}),
            }
          : {
              url: custom.url,
              ...(headers ? { headers } : {}),
            }),
        enabled: true,
      });
      await afterMutation(result, `Added ${custom.id || custom.name}`);
      closeWizard();
    });

  return {
    enabled,
    servers,
    catalog,
    query,
    setQuery,
    q,
    error,
    setError,
    note,
    busy,
    wizardOpen,
    wizardStep,
    setWizardStep,
    custom,
    setCustom,
    selectedBuiltin,
    setSelectedBuiltin,
    secretDraft,
    setSecretDraft,
    dbConnectMethod,
    setDbConnectMethod,
    filteredServers,
    availableCatalog,
    selectedCatalogEntry,
    reload,
    openWizard,
    closeWizard,
    toggleMaster,
    toggleServer,
    removeServer,
    beginCatalogInstall,
    installSelectedBuiltin,
    confirmCatalogSecrets,
    createCustom,
  };
}

export type McpManagerModel = ReturnType<typeof useMcpManager>;
