import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { getProviderPreset, PROVIDER_OPTIONS } from '../providerOptions';
import type {
  CheckpointItemView,
  ContextToggles,
  IndexStatusSnapshot,
  McpRuntimeStatus,
  McpServerConfig,
  McpSettings,
  MemoryItemView,
  ProviderSettingsSnapshot,
  SemanticIndexSource,
  SettingsTab,
  SettingsProfileView,
  TokenBudgetFieldDescriptor,
  TokenBudgetPreview,
  UiSettingsPatch,
  UiSettingsSnapshot,
  WorkspaceSnapshotInfo,
} from '../protocol';
import { CheckpointPanel } from './CheckpointPanel';
import { ContextTogglesPanel } from './ContextTogglesPanel';
import { McpServersEditor } from './McpServersEditor';
import { MemoryPanel } from './MemoryPanel';
import {
  IconAgent,
  IconAsk,
  IconBug,
  IconFolder,
  IconLayers,
  IconModel,
  IconPlan,
  IconPlug,
} from './Icons';
import { TokenBudgetFieldHelp } from './TokenBudgetFieldHelp';

interface SettingsPanelProps {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  workspace: WorkspaceSnapshotInfo;
  overrideDraft: string;
  onOverrideDraftChange: (value: string) => void;
  onClearOverride: () => void;
  onOpenFolder: () => void;
  profiles: SettingsProfileView[];
  activeProfileId: string;
  onActiveProfileChange: (id: string) => void;
  onCreateProfile: (name: string) => void;
  provider: ProviderSettingsSnapshot;
  onProviderChange: (
    next:
      | ProviderSettingsSnapshot
      | ((prev: ProviderSettingsSnapshot) => ProviderSettingsSnapshot),
  ) => void;
  onProviderTypeChange: (type: string) => void;
  onSetApiKey: () => void;
  onClearApiKey: () => void;
  onTestConnection: () => void;
  testingConnection: boolean;
  connectionMessage: string | null;
  customModel: boolean;
  onCustomModelChange: (value: boolean) => void;
  modelOptions: string[];
  ui: UiSettingsSnapshot;
  onSaveUi: (patch: UiSettingsPatch) => void;
  mcp: McpSettings;
  mcpStore: McpServerConfig[];
  mcpRuntimeStatus: McpRuntimeStatus;
  onMcpChange: (next: McpSettings) => void;
  index: IndexStatusSnapshot;
  onReindex: () => void;
  onRefreshIndex: () => void;
  onEmbeddingSourceChange: (source: SemanticIndexSource) => void;
  memories: MemoryItemView[];
  onAddMemory: (text: string) => void;
  onDeleteMemory: (id: string) => void;
  onClearMemory: () => void;
  checkpoints: CheckpointItemView[];
  onRestoreCheckpoint: (id: string) => void;
  onDeleteCheckpoint: (id: string) => void;
  onClearCheckpoints: () => void;
  onToggleContext: (source: keyof ContextToggles, enabled: boolean) => void;
  onSaveAll: () => void;
  onResetTokenBudget: () => void;
  saving: boolean;
}

const COMPACT_MAX_WIDTH = 440;

const NAV: {
  id: SettingsTab;
  label: string;
  icon: ReactNode;
}[] = [
  { id: 'model', label: 'Provider', icon: <IconModel /> },
  { id: 'workspace', label: 'Workspace', icon: <IconFolder /> },
  { id: 'modes', label: 'Modes', icon: <IconPlan /> },
  { id: 'context', label: 'Context', icon: <IconLayers /> },
  { id: 'integrations', label: 'MCP', icon: <IconPlug /> },
  { id: 'debug', label: 'Developer', icon: <IconBug /> },
];

const PAGE_COPY: Record<SettingsTab, { title: string; description: string }> = {
  model: {
    title: 'Provider',
    description: 'Connect a model first. Everything else depends on this.',
  },
  workspace: {
    title: 'Workspace',
    description: 'Folder and local index used for context.',
  },
  modes: {
    title: 'Modes',
    description: 'Defaults and run limits for Ask, Plan, and Agent.',
  },
  context: {
    title: 'Context',
    description: 'What Mitii attaches to each turn.',
  },
  integrations: {
    title: 'MCP',
    description: 'Optional servers. Off by default.',
  },
  debug: {
    title: 'Developer',
    description: 'Diagnostics and advanced controls. Leave off unless you need them.',
  },
};

function mergeModelOptions(
  available: string[] | undefined,
  current: string,
): string[] {
  const set = new Set<string>();
  if (current.trim()) set.add(current.trim());
  for (const id of available ?? []) {
    if (id.trim()) set.add(id.trim());
  }
  return [...set];
}

const INDEX_CAPABILITY_LABELS: Record<string, string> = {
  catalog: 'Catalog',
  codeIndex: 'Code index',
  textIndex: 'Text index',
  vectorIndex: 'Embeddings',
  graph: 'Graph',
  map: 'Repo map',
};

function displayCapabilityStatus(capability: {
  capability: string;
  status: string;
  reasonCode?: string;
}): { className: string; label: string } {
  if (capability.capability === 'vectorIndex') {
    if (capability.status === 'unavailable') {
      return { className: 'optional', label: 'not configured' };
    }
    if (capability.status === 'degraded') {
      return { className: 'degraded', label: 'degraded — reindex' };
    }
  }
  return { className: capability.status, label: capability.status };
}

function formatIndexMode(mode: IndexStatusSnapshot['indexMode']): string {
  if (mode === 'full') return 'Full code/text index';
  if (mode === 'host_snapshot') return 'Host snapshot fallback';
  return 'Unknown';
}

function capabilityDetails(index: IndexStatusSnapshot) {
  return [...(index.capabilities ?? [])].sort((a, b) => {
    const left = `${a.rootId ?? ''}:${a.capability}`;
    const right = `${b.rootId ?? ''}:${b.capability}`;
    return left.localeCompare(right);
  });
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <header className="settings-section__header">
        <h3 className="settings-section__title">{title}</h3>
        {description ? (
          <p className="settings-section__desc">{description}</p>
        ) : null}
      </header>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  disabled,
  integer = true,
  hint,
  footer,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  integer?: boolean;
  hint?: string;
  footer?: ReactNode;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const draftRef = useRef(draft);
  const focusedRef = useRef(false);
  draftRef.current = draft;

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(String(value));
    }
  }, [value]);

  const parseDraft = (nextDraft: string): number | undefined => {
    if (!nextDraft.trim()) {
      return undefined;
    }
    const parsed = Number(nextDraft);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    const rounded = integer ? Math.floor(parsed) : parsed;
    return Math.max(
      min ?? Number.NEGATIVE_INFINITY,
      Math.min(max ?? Number.POSITIVE_INFINITY, rounded),
    );
  };

  const commit = (nextDraft: string) => {
    const bounded = parseDraft(nextDraft);
    if (bounded === undefined) {
      setDraft(String(value));
      return;
    }
    setDraft(String(bounded));
    if (bounded !== value) onCommit(bounded);
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step="any"
        disabled={disabled}
        title={hint}
        data-step={step}
        value={draft}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => {
          const nextDraft = e.target.value;
          draftRef.current = nextDraft;
          setDraft(nextDraft);
        }}
        onBlur={() => {
          focusedRef.current = false;
          commit(draftRef.current);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draftRef.current);
          }
        }}
      />
      {footer}
    </div>
  );
}

function KeyValueList({
  rows,
}: {
  rows: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="settings-kv">
      {rows.map((row) => (
        <div key={row.label} className="settings-kv__row">
          <dt>{row.label}</dt>
          <dd className="mono">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CustomerWindowBudgetSummary({
  preview,
}: {
  preview: TokenBudgetPreview;
}) {
  return (
    <div className="token-budget-preview">
      <p className="field-hint">
        These values follow the context window automatically. You do not need
        Developer options. Click Save after changing the window to recompute.
      </p>
      <KeyValueList
        rows={[
          { label: 'Effective window', value: String(preview.contextWindowTokens) },
          { label: 'Usable input', value: String(preview.usableInputTokens) },
          { label: 'Output reserve', value: String(preview.maximumOutputTokens) },
          { label: 'Model-call cap', value: String(preview.maxModelCalls) },
          {
            label: 'Files per mutation',
            value: String(preview.maxUniqueFilesPerCall),
          },
          {
            label: 'Verification checks',
            value: String(preview.maxVerificationChecks),
          },
        ]}
      />
    </div>
  );
}

function TokenBudgetPreviewTable({ preview }: { preview: TokenBudgetPreview }) {
  const rows: Array<[string, string]> = [
    ['Window', String(preview.contextWindowTokens)],
    ['Output reserve', String(preview.maximumOutputTokens)],
    ['Tool schemas', String(preview.toolSchemaTokens)],
    ['Usable input', String(preview.usableInputTokens)],
    ['Repository', String(preview.repositoryTokens)],
    ['Conversation', String(preview.conversationTokens)],
    ['Plan', String(preview.planTokens)],
    ['Skills', String(preview.skillsTokens)],
    ['System / rules', String(preview.systemTokens)],
    ['Model-call cap', String(preview.maxModelCalls)],
    ['Tool-call cap', String(preview.maxToolCalls)],
    ['Files per mutation', String(preview.maxUniqueFilesPerCall)],
    ['Patch payload chars', String(preview.maxPatchPayloadCharacters)],
    ['Recent tool results', String(preview.keepRecentToolResults)],
    ['Tool result content', `${preview.toolResultContentChars} chars`],
    ['Observation facts', String(preview.maxEstablishedFacts)],
    ['Verification checks', String(preview.maxVerificationChecks)],
    ['Visible plan', preview.visiblePlanAffordable ? 'affordable' : 'skipped'],
    [
      'Change impact',
      preview.changeImpactAffordable ? 'affordable' : 'skipped',
    ],
    [
      'Run budget (Modes)',
      preview.runBudgetUnlimited
        ? 'Unlimited'
        : `${preview.runBudgetMaxModelCalls} model / ${preview.runBudgetMaxToolCalls} tools`,
    ],
  ];
  return (
    <div className="token-budget-preview">
      <p className="field-hint">
        Derived split for the current window. Save to recompute. Shares are of
        usable input (window − output − tools). Model and tool call limits are
        owned by Modes → Run budget.
      </p>
      <KeyValueList
        rows={rows.map(([label, value]) => ({ label, value }))}
      />
    </div>
  );
}

function TokenBudgetFields({
  fields,
  policy,
  preview,
  disabled,
  onChange,
}: {
  fields: TokenBudgetFieldDescriptor[];
  policy: Record<string, number>;
  preview: TokenBudgetPreview;
  disabled: boolean;
  onChange: (key: string, value: number) => void;
}) {
  const groups = useMemo(() => {
    const next = new Map<string, TokenBudgetFieldDescriptor[]>();
    for (const field of fields) {
      if (field.hiddenFromDebug) continue;
      const group = next.get(field.group) ?? [];
      group.push(field);
      next.set(field.group, group);
    }
    return [...next.entries()];
  }, [fields]);

  if (fields.length === 0) {
    return (
      <p className="field-hint">
        Token-budget fields appear after the host sends settings.
      </p>
    );
  }

  return (
    <div className="token-budget-fields">
      {groups.map(([group, groupFields]) => (
        <div key={group} className="token-budget-group">
          <h4 className="settings-category__title">{group}</h4>
          <div className="settings-field-grid">
            {groupFields.map((field) => (
              <NumberField
                key={field.key}
                id={`tokenBudget.${field.key}`}
                label={field.label}
                min={field.min}
                max={field.max}
                step={field.step}
                integer={field.kind === 'int'}
                disabled={disabled}
                hint={field.description}
                value={policy[field.key] ?? field.min}
                footer={
                  <TokenBudgetFieldHelp
                    field={field}
                    value={policy[field.key] ?? field.min}
                    preview={preview}
                  />
                }
                onCommit={(value) => onChange(field.key, value)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    tab,
    onTabChange,
    workspace,
    overrideDraft,
    onOverrideDraftChange,
    onClearOverride,
    onOpenFolder,
    profiles,
    activeProfileId,
    onActiveProfileChange,
    onCreateProfile,
    provider,
    onProviderChange,
    onProviderTypeChange,
    onSetApiKey,
    onClearApiKey,
    onTestConnection,
    testingConnection,
    connectionMessage,
    customModel,
    onCustomModelChange,
    modelOptions,
    ui,
    onSaveUi,
    mcp,
    mcpStore,
    mcpRuntimeStatus,
    onMcpChange,
    index,
    onReindex,
    onRefreshIndex,
    onEmbeddingSourceChange,
    memories,
    onAddMemory,
    onDeleteMemory,
    onClearMemory,
    checkpoints,
    onRestoreCheckpoint,
    onDeleteCheckpoint,
    onClearCheckpoints,
    onToggleContext,
    onSaveAll,
    onResetTokenBudget,
    saving,
  } = props;
  const [modeSettingsTab, setModeSettingsTab] =
    useState<'ask' | 'plan' | 'agent'>('ask');
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [iconTooltip, setIconTooltip] = useState<{
    label: string;
    top: number;
  } | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') {
      return;
    }
    const update = () => {
      setCompact(root.clientWidth <= COMPACT_MAX_WIDTH);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!compact) setIconTooltip(null);
  }, [compact]);

  const showIconTooltip = useCallback(
    (label: string, target: HTMLElement) => {
      const root = rootRef.current;
      if (!root || root.clientWidth > COMPACT_MAX_WIDTH) {
        setIconTooltip(null);
        return;
      }
      const rootBox = root.getBoundingClientRect();
      const itemBox = target.getBoundingClientRect();
      setIconTooltip({
        label,
        top: itemBox.top - rootBox.top + itemBox.height / 2,
      });
    },
    [],
  );

  const hideIconTooltip = useCallback(() => {
    setIconTooltip(null);
  }, []);

  const options = useMemo(
    () =>
      mergeModelOptions(
        [
          ...modelOptions,
          ...Object.values(ui.modeDefaults ?? {})
            .map((entry) => entry.model ?? '')
            .filter(Boolean),
        ],
        provider.model,
      ),
    [modelOptions, provider.model, ui.modeDefaults],
  );

  const activeTab = NAV.some((item) => item.id === tab) ? tab : 'model';
  const page = PAGE_COPY[activeTab];
  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const modeDefault =
    ui.modeDefaults?.[modeSettingsTab] ?? {
      depth: ui.depth,
      approvalMode: ui.approvalMode,
      model: provider.model,
    };
  const embeddingsDegraded = index.capabilities?.some(
    (capability) =>
      capability.capability === 'vectorIndex' &&
      capability.status === 'degraded',
  );
  const keyRequired =
    provider.type === 'anthropic' || provider.type === 'gemini';

  return (
    <div
      ref={rootRef}
      className={`settings-view${compact ? ' is-compact' : ''}`}
    >
      <nav className="settings-nav" aria-label="Settings">
        {NAV.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            className={`settings-nav__item${activeTab === id ? ' is-active' : ''}`}
            aria-current={activeTab === id ? 'page' : undefined}
            aria-label={label}
            title={compact ? label : undefined}
            onMouseEnter={(event) =>
              showIconTooltip(label, event.currentTarget)
            }
            onMouseLeave={hideIconTooltip}
            onFocus={(event) => showIconTooltip(label, event.currentTarget)}
            onBlur={hideIconTooltip}
            onClick={() => onTabChange(id)}
          >
            <span className="settings-nav__icon">{icon}</span>
            <span className="settings-nav__label">{label}</span>
          </button>
        ))}
      </nav>
      {compact && iconTooltip ? (
        <div
          className="settings-nav-tooltip"
          role="tooltip"
          style={{ top: iconTooltip.top }}
        >
          {iconTooltip.label}
        </div>
      ) : null}

      <div className="settings-main">
        <div className="settings-body">
          <header className="settings-page-header">
            <h2 className="settings-page-header__title">{page.title}</h2>
            <p className="settings-page-header__desc">{page.description}</p>
          </header>

          {activeTab === 'model' ? (
            <div className="settings-panel">
              <SettingsSection
                title="Connection"
                description="Choose the provider and model Mitii will call."
              >
                <div className="field">
                  <label htmlFor="ptype">Provider</label>
                  <select
                    id="ptype"
                    value={provider.preset ?? provider.type}
                    onChange={(e) => onProviderTypeChange(e.target.value)}
                  >
                    {PROVIDER_OPTIONS.map((option) => (
                      <option key={option.preset} value={option.preset}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {provider.type !== 'echo' ? (
                  <div className="field">
                    <label htmlFor="base">Base URL</label>
                    <input
                      id="base"
                      value={provider.baseUrl}
                      placeholder={
                        provider.type === 'anthropic'
                          ? 'https://api.anthropic.com'
                          : provider.type === 'gemini'
                            ? 'https://generativelanguage.googleapis.com'
                            : 'http://localhost:11434/v1'
                      }
                      onChange={(e) =>
                        onProviderChange((prev) => ({
                          ...prev,
                          baseUrl: e.target.value,
                        }))
                      }
                    />
                    <p className="field-hint">
                      {provider.type === 'anthropic' ||
                      provider.type === 'gemini'
                        ? 'Override only for a proxy or regional endpoint.'
                        : 'Local hosts do not need an API key.'}
                    </p>
                  </div>
                ) : null}
                <div className="field">
                  <label htmlFor="model">Model</label>
                  <select
                    id="model"
                    value={
                      customModel || !options.includes(provider.model)
                        ? '__custom__'
                        : provider.model
                    }
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next === '__custom__') {
                        onCustomModelChange(true);
                        return;
                      }
                      onCustomModelChange(false);
                      onProviderChange((prev) => ({ ...prev, model: next }));
                    }}
                  >
                    {options.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                    <option value="__custom__">Custom…</option>
                  </select>
                  {customModel || !options.includes(provider.model) ? (
                    <input
                      className="settings-follow-input"
                      value={provider.model}
                      placeholder="custom model id"
                      onChange={(e) =>
                        onProviderChange((prev) => ({
                          ...prev,
                          model: e.target.value,
                        }))
                      }
                    />
                  ) : null}
                </div>
              </SettingsSection>

              <SettingsSection title="Credentials">
                <div className="row">
                  <span className="mono">
                    API key: {provider.hasApiKey ? 'configured' : 'not set'}
                    {keyRequired ? ' (required)' : ''}
                  </span>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={onSetApiKey}
                    title="Set API key"
                  >
                    Set key
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={onClearApiKey}
                    title="Clear API key"
                  >
                    Clear
                  </button>
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={onTestConnection}
                    disabled={testingConnection}
                    title="Test provider connection"
                  >
                    {testingConnection ? 'Testing…' : 'Test connection'}
                  </button>
                  {connectionMessage || provider.connectionStatus ? (
                    <span
                      className={`settings-status-pill${
                        provider.connectionOk
                          ? ' settings-status-pill--ok'
                          : provider.connectionOk === false
                            ? ' settings-status-pill--err'
                            : ''
                      }`}
                    >
                      {connectionMessage ?? provider.connectionStatus}
                    </span>
                  ) : null}
                </div>
              </SettingsSection>

              <SettingsSection
                title="Token limits"
                description="Set the context window for this machine. Mitii scales retrieval, compaction, mutation batches, and verification from that window. Developer options are not required."
              >
                <div className="settings-field-grid">
                  <NumberField
                    id="contextWindow"
                    label="Context window"
                    min={0}
                    step={1}
                    value={provider.contextWindow}
                    onCommit={(value) =>
                      onProviderChange((prev) => ({
                        ...prev,
                        contextWindow: value,
                      }))
                    }
                  />
                  <NumberField
                    id="maxOutput"
                    label="Max output"
                    min={0}
                    step={1}
                    value={provider.maximumOutputTokens}
                    onCommit={(value) =>
                      onProviderChange((prev) => ({
                        ...prev,
                        maximumOutputTokens: value,
                      }))
                    }
                  />
                </div>
                <p className="field-hint">
                  {provider.contextWindow === 0
                    ? `Context window 0 uses the model preset${
                        provider.effectiveContextWindow
                          ? ` (currently ${provider.effectiveContextWindow.toLocaleString()} tokens)`
                          : ''
                      }.`
                    : `Context window will save as ${provider.contextWindow.toLocaleString()} tokens.`}{' '}
                  {provider.maximumOutputTokens === 0
                    ? 'Max output 0 derives the reserve from the window.'
                    : `Max output will save as ${provider.maximumOutputTokens.toLocaleString()} tokens.`}
                </p>
                {ui.tokenBudget.enabled ? (
                  <p className="field-hint">
                    Custom token-budget overrides are on. Use Reset budgets to
                    defaults if you only want the context window to drive these
                    numbers.
                  </p>
                ) : null}
                <CustomerWindowBudgetSummary preview={ui.tokenBudget.preview} />
                <div className="row">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={onResetTokenBudget}
                    title="Clear custom token-budget overrides and use built-in defaults for this window"
                  >
                    Reset budgets to defaults
                  </button>
                </div>
              </SettingsSection>
            </div>
          ) : null}

          {activeTab === 'workspace' ? (
            <div className="settings-panel">
              <SettingsSection
                title="Folder"
                description="Active folder used for indexing, context, and agent runs."
              >
                <div className="settings-path mono">
                  {workspace.displayRoot ?? 'No folder open'}
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={onOpenFolder}
                  >
                    Open folder
                  </button>
                </div>
                <details className="settings-advanced">
                  <summary>Advanced</summary>
                  <div className="field">
                    <label htmlFor="override">Root path override</label>
                    <input
                      id="override"
                      value={overrideDraft}
                      placeholder={workspace.root ?? '/path/to/repo'}
                      onChange={(e) => onOverrideDraftChange(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={onClearOverride}
                  >
                    Clear override
                  </button>
                </details>
              </SettingsSection>

              <SettingsSection
                title="Repository index"
                description="Local file map used by Ask, Plan, Agent, and Review."
              >
                <div className="field">
                  <label htmlFor="embedding-source">Embedding source</label>
                  <select
                    id="embedding-source"
                    value={index.embeddingSource ?? 'bundled'}
                    onChange={(e) =>
                      onEmbeddingSourceChange(
                        e.target.value as SemanticIndexSource,
                      )
                    }
                  >
                    <option value="bundled">
                      Bundled MiniLM (on-device)
                    </option>
                    <option value="ollama">Ollama embeddings API</option>
                    <option value="openai-compatible">
                      OpenAI-compatible embeddings API
                    </option>
                    <option value="disabled">Disabled (lexical only)</option>
                  </select>
                  <p className="field-hint">
                    {index.embeddingEnabled === false
                      ? 'Semantic search is off. Reindex after enabling a source.'
                      : index.embeddingSource === 'bundled'
                        ? `On-device ${index.embeddingModel ?? 'all-MiniLM-L6-v2'} (384-d). Native ONNX when available, WASM otherwise. Reindex after changing source.`
                        : index.embeddingSource === 'ollama'
                          ? `HTTP embeddings via Ollama (${index.embeddingModel ?? 'nomic-embed-text'}). Reindex after changing source.`
                          : index.embeddingSource === 'openai-compatible'
                            ? `HTTP embeddings via the OpenAI-compatible API (${index.embeddingModel ?? 'text-embedding-3-small'}). Reindex after changing source.`
                            : 'LanceDB stores vectors; it is not an embedding source.'}
                  </p>
                </div>
                <KeyValueList
                  rows={[
                    { label: 'Indexed items', value: index.fileCount },
                    { label: 'Readiness', value: index.readiness ?? '—' },
                    { label: 'Scan', value: index.scanCompleteness ?? '—' },
                    { label: 'Mode', value: formatIndexMode(index.indexMode) },
                  ]}
                />
                {capabilityDetails(index).length > 0 ? (
                  <div
                    className="index-capability-list"
                    aria-label="Repository index capability status"
                  >
                    {capabilityDetails(index).map((capability) => {
                      const label =
                        INDEX_CAPABILITY_LABELS[capability.capability] ??
                        capability.capability;
                      const displayStatus = displayCapabilityStatus(capability);
                      return (
                        <div
                          key={`${capability.rootId ?? 'root'}:${capability.capability}`}
                          className={`index-capability index-capability--${displayStatus.className}`}
                          title={[
                            capability.rootId
                              ? `Root: ${capability.rootId}`
                              : undefined,
                            capability.revision
                              ? `Revision: ${capability.revision}`
                              : undefined,
                            capability.profile
                              ? `Profile: ${capability.profile}`
                              : undefined,
                            capability.reasonCode
                              ? `Reason: ${capability.reasonCode}`
                              : undefined,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          <span className="index-capability__name">{label}</span>
                          <span className="index-capability__status">
                            {displayStatus.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <p className="field-hint">
                  {index.message ?? 'No index yet'}
                  {index.truncated ? ' · truncated' : ''}
                  {embeddingsDegraded
                    ? ' · Semantic search is degraded. Reindex to rebuild embeddings.'
                    : ''}
                </p>
                <div className="row">
                  <button type="button" className="btn" onClick={onReindex}>
                    {embeddingsDegraded ? 'Reindex embeddings' : 'Reindex'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={onRefreshIndex}
                  >
                    Refresh
                  </button>
                </div>
              </SettingsSection>
            </div>
          ) : null}

          {activeTab === 'modes' ? (
            <div className="settings-panel">
              <SettingsSection title="Mode defaults">
                <div
                  className="mode-settings-tabs"
                  role="tablist"
                  aria-label="Mode settings"
                >
                  {[
                    { id: 'ask' as const, label: 'Ask', icon: <IconAsk /> },
                    { id: 'plan' as const, label: 'Plan', icon: <IconPlan /> },
                    {
                      id: 'agent' as const,
                      label: 'Agent',
                      icon: <IconAgent />,
                    },
                  ].map((modeTab) => (
                    <button
                      key={modeTab.id}
                      type="button"
                      role="tab"
                      aria-selected={modeSettingsTab === modeTab.id}
                      className={`mode-settings-tab${
                        modeSettingsTab === modeTab.id ? ' is-active' : ''
                      }`}
                      onClick={() => setModeSettingsTab(modeTab.id)}
                    >
                      <span className="mode-settings-tab__icon">
                        {modeTab.icon}
                      </span>
                      <span>{modeTab.label}</span>
                    </button>
                  ))}
                </div>
                <p className="mode-settings-summary">
                  {modeSettingsTab === 'ask'
                    ? 'Ask stays lightweight: read, explain, and answer with minimal workspace impact.'
                    : modeSettingsTab === 'plan'
                      ? 'Plan focuses on structure: clarify scope, draft phases, and save a handoff-ready plan.'
                      : 'Agent is execution-focused: use tools, edit files, and stop at approval and budget limits.'}
                </p>
                <div className="field">
                  <label htmlFor="depth">Default depth</label>
                  <select
                    id="depth"
                    value={modeDefault.depth}
                    onChange={(e) =>
                      onSaveUi({
                        modeDefaults: {
                          [modeSettingsTab]: {
                            depth: e.target.value as UiSettingsSnapshot['depth'],
                          },
                        },
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="quick">Quick</option>
                    <option value="deep">Deep</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="approval">Approval mode</label>
                  <select
                    id="approval"
                    value={
                      modeDefault.approvalMode === 'builder'
                        ? 'guided'
                        : modeDefault.approvalMode
                    }
                    onChange={(e) =>
                      onSaveUi({
                        modeDefaults: {
                          [modeSettingsTab]: { approvalMode: e.target.value },
                        },
                      })
                    }
                  >
                    <option value="safe">Ask for approval</option>
                    <option value="guided">Approve for me</option>
                    <option value="pilot">Full access</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="modeModel">Default model</label>
                  <select
                    id="modeModel"
                    value={modeDefault.model ?? ''}
                    onChange={(e) =>
                      onSaveUi({
                        modeDefaults: {
                          [modeSettingsTab]: { model: e.target.value },
                        },
                      })
                    }
                  >
                    <option value="">Use active model</option>
                    {options.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={ui.showReasoning}
                    onChange={(e) =>
                      onSaveUi({ showReasoning: e.target.checked })
                    }
                  />
                  Show reasoning stream
                </label>
                <NumberField
                  id="preview"
                  label="Reasoning preview chars"
                  min={500}
                  max={50000}
                  value={ui.reasoningPreviewMaxChars}
                  onCommit={(value) =>
                    onSaveUi({
                      reasoningPreviewMaxChars: value,
                    })
                  }
                />
              </SettingsSection>
              <SettingsSection
                title="Run budget"
                description="Optional safety caps for one turn. You do not need to retune these when you change the context window."
              >
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={ui.runBudget.unlimited}
                    onChange={(e) =>
                      onSaveUi({
                        runBudget: { unlimited: e.target.checked },
                      })
                    }
                  />
                  Unlimited run budget
                </label>
                <div className="settings-field-grid">
                  <NumberField
                    id="maxModelCalls"
                    label="Model calls"
                    min={1}
                    disabled={ui.runBudget.unlimited}
                    value={ui.runBudget.maxModelCalls}
                    onCommit={(value) =>
                      onSaveUi({
                        runBudget: { maxModelCalls: value },
                      })
                    }
                  />
                  <NumberField
                    id="maxToolCalls"
                    label="Tool calls"
                    min={1}
                    disabled={ui.runBudget.unlimited}
                    value={ui.runBudget.maxToolCalls}
                    onCommit={(value) =>
                      onSaveUi({
                        runBudget: { maxToolCalls: value },
                      })
                    }
                  />
                  <NumberField
                    id="maxLoopIterations"
                    label="Loop iterations"
                    min={1}
                    disabled={ui.runBudget.unlimited}
                    value={ui.runBudget.maxLoopIterations}
                    onCommit={(value) =>
                      onSaveUi({
                        runBudget: { maxLoopIterations: value },
                      })
                    }
                  />
                  <NumberField
                    id="maxWallTimeMinutes"
                    label="Wall time (min)"
                    min={1}
                    disabled={ui.runBudget.unlimited}
                    value={ui.runBudget.maxWallTimeMinutes}
                    onCommit={(value) =>
                      onSaveUi({
                        runBudget: { maxWallTimeMinutes: value },
                      })
                    }
                  />
                </div>
              </SettingsSection>
            </div>
          ) : null}

          {activeTab === 'context' ? (
            <div className="settings-panel">
              <SettingsSection
                title="Sources"
                description="Choose what evidence is attached to each turn."
              >
                <ContextTogglesPanel
                  toggles={ui.contextToggles}
                  onToggle={onToggleContext}
                />
              </SettingsSection>
              <MemoryPanel
                memories={memories}
                onAdd={onAddMemory}
                onDelete={onDeleteMemory}
                onClear={onClearMemory}
              />
              <CheckpointPanel
                checkpoints={checkpoints}
                onRestore={onRestoreCheckpoint}
                onDelete={onDeleteCheckpoint}
                onClear={onClearCheckpoints}
              />
            </div>
          ) : null}

          {activeTab === 'integrations' ? (
            <div className="settings-panel">
              <SettingsSection
                title="Servers"
                description="Install what you need. Delete anytime."
              >
                <McpServersEditor
                  mcp={mcp}
                  storeCatalog={mcpStore}
                  runtimeStatus={mcpRuntimeStatus}
                  onChange={onMcpChange}
                />
              </SettingsSection>
            </div>
          ) : null}

          {activeTab === 'debug' ? (
            <div className="settings-panel">
              <SettingsSection
                title="Access"
                description="Unlocks logging and token-budget editors below."
              >
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={ui.developerEnabled}
                    onChange={(e) =>
                      onSaveUi({ developerEnabled: e.target.checked })
                    }
                  />
                  Enable developer settings
                </label>
              </SettingsSection>

              <SettingsSection
                title="Logging"
                description="Verbose stacks in the Mitii Output channel."
              >
                <div
                  className={`developer-options${
                    ui.developerEnabled ? '' : ' is-locked'
                  }`}
                >
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={ui.debugLogging}
                      disabled={!ui.developerEnabled}
                      onChange={(e) =>
                        onSaveUi({ debugLogging: e.target.checked })
                      }
                    />
                    Debug logging
                  </label>
                  <p className="field-hint">
                    When on, Mitii shows the Output channel and prints verbose
                    stacks on failures (
                    <span className="mono">mitii.debug</span>).
                  </p>
                </div>
              </SettingsSection>

              <SettingsSection
                title="Token budget"
                description="Optional overrides. Leave this off unless you need to change ratios. The context window already scales the built-in defaults."
              >
                <div
                  className={`developer-options${
                    ui.developerEnabled ? '' : ' is-locked'
                  }`}
                >
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={ui.tokenBudget.enabled}
                      disabled={!ui.developerEnabled}
                      onChange={(e) =>
                        onSaveUi({
                          tokenBudget: { enabled: e.target.checked },
                        })
                      }
                    />
                    Custom token budget
                  </label>
                  <TokenBudgetPreviewTable preview={ui.tokenBudget.preview} />
                  <div className="row">
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={onResetTokenBudget}
                      disabled={!ui.developerEnabled}
                    >
                      Reset budgets to defaults
                    </button>
                  </div>
                  <TokenBudgetFields
                    fields={ui.tokenBudget.fields}
                    policy={ui.tokenBudget.policy}
                    preview={ui.tokenBudget.preview}
                    disabled={!ui.developerEnabled || !ui.tokenBudget.enabled}
                    onChange={(key, value) =>
                      onSaveUi({
                        tokenBudget: { policy: { [key]: value } },
                      })
                    }
                  />
                </div>
              </SettingsSection>

              <SettingsSection
                title="Diagnostics"
                description="Use View → Output → Mitii for activation and run logs."
              >
                <KeyValueList
                  rows={[
                    {
                      label: 'Provider',
                      value:
                        provider.connectionStatus ??
                        (provider.connectionOk === true
                          ? 'OK'
                          : provider.connectionOk === false
                            ? 'Failed'
                            : 'Not tested'),
                    },
                    { label: 'MCP runtime', value: mcpRuntimeStatus },
                    {
                      label: 'Index token',
                      value: index.stateTokenPreview ?? '—',
                    },
                    {
                      label: 'Index mode',
                      value: `${formatIndexMode(index.indexMode)} · files=${index.fileCount}`,
                    },
                    {
                      label: 'Preset',
                      value:
                        getProviderPreset(provider.preset ?? provider.type)
                          ?.label ?? provider.type,
                    },
                  ]}
                />
              </SettingsSection>
            </div>
          ) : null}
        </div>

        <div className="settings-footer">
          <div className="settings-footer__profiles">
            <select
              aria-label="Switch profile"
              value={activeProfile?.id ?? activeProfileId}
              onChange={(e) => onActiveProfileChange(e.target.value)}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setNewProfileName('');
                setNewProfileOpen(true);
              }}
            >
              New
            </button>
          </div>
          <button
            type="button"
            className="btn settings-save-btn"
            onClick={onSaveAll}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {newProfileOpen ? (
        <div
          className="settings-modal-backdrop"
          role="presentation"
          onMouseDown={() => setNewProfileOpen(false)}
        >
          <form
            className="settings-modal"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              onCreateProfile(newProfileName);
              setNewProfileOpen(false);
            }}
          >
            <h3>New profile</h3>
            <div className="field">
              <label htmlFor="newProfileName">Profile name</label>
              <input
                id="newProfileName"
                autoFocus
                value={newProfileName}
                placeholder="Local Ollama"
                onChange={(e) => setNewProfileName(e.target.value)}
              />
            </div>
            <div className="row settings-modal__actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setNewProfileOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn">
                Create
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
