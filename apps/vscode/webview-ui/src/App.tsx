import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { onHostMessage, postToHost } from './bridge';
import { getProviderPreset, PROVIDER_OPTIONS } from './providerOptions';
import type {
  ActivityEventPayload,
  AgentUiDepth,
  AgentUiMode,
  HostToWebviewMessage,
  IndexStatusSnapshot,
  McpSettings,
  PathSuggestion,
  ProviderSettingsSnapshot,
  SettingsTab,
  SuspensionPayload,
  TokenUsageSnapshot,
  UiNav,
  UiSettingsSnapshot,
  WorkspaceSnapshotInfo,
} from './protocol';
import { TokenMeter } from './TokenMeter';

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  mode?: AgentUiMode;
  streaming?: boolean;
  activity: ActivityEventPayload[];
  status?: string;
  route?: string | null;
  suspension?: SuspensionPayload;
}

const MODE_HINT: Record<AgentUiMode, string> = {
  ask: 'Explore and answer — read-only.',
  plan: 'Analyze and propose a structured plan.',
  agent: 'Implement changes with controlled execution.',
};

const EMPTY_TOKEN_USAGE: TokenUsageSnapshot = {
  sessionTotal: 0,
  inputTokensTotal: 0,
  outputTokensTotal: 0,
  currentTurnTotal: 0,
  currentTurnInputTokens: 0,
  currentTurnOutputTokens: 0,
  aiCallCount: 0,
  modelCalls: 0,
  toolCalls: 0,
  loopIterations: 0,
  lastPromptTokens: 0,
  lastResponseTokens: 0,
  turnCount: 0,
  contextWindow: 8192,
  estimated: true,
};

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

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

export function App() {
  const [nav, setNav] = useState<UiNav>('chat');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('workspace');
  const [mode, setMode] = useState<AgentUiMode>('ask');
  const [depth, setDepth] = useState<AgentUiDepth>('auto');
  const [prompt, setPrompt] = useState('');
  const [pinned, setPinned] = useState<string[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [activeSuggest, setActiveSuggest] = useState(0);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshotInfo>({});
  const [provider, setProvider] = useState<ProviderSettingsSnapshot>({
    type: 'echo',
    baseUrl: '',
    model: '',
    hasApiKey: false,
    availableModels: [],
  });
  const [tokenUsage, setTokenUsage] =
    useState<TokenUsageSnapshot>(EMPTY_TOKEN_USAGE);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );
  const [customModel, setCustomModel] = useState(false);
  const [index, setIndex] = useState<IndexStatusSnapshot>({
    fileCount: 0,
    truncated: false,
  });
  const [mcp, setMcp] = useState<McpSettings>({ enabled: false, servers: [] });
  const [ui, setUi] = useState<UiSettingsSnapshot>({
    showReasoning: true,
    reasoningPreviewMaxChars: 8000,
    depth: 'auto',
  });
  const [clarifyText, setClarifyText] = useState('');
  const [activityOpen, setActivityOpen] = useState(true);
  const [overrideDraft, setOverrideDraft] = useState('');

  const searchReq = useRef(0);
  const lastSearchId = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeAssistantId = useRef<string | null>(null);

  const applyBootstrap = useCallback((msg: HostToWebviewMessage) => {
    if (msg.type === 'bootstrap' || msg.type === 'settings') {
      setWorkspace(msg.workspace);
      setProvider(msg.provider);
      setMcp(msg.mcp);
      setUi(msg.ui);
      setDepth(msg.ui.depth);
      setOverrideDraft(msg.workspace.rootOverride ?? '');
      setTokenUsage(msg.tokenUsage);
      setCustomModel(false);
      if (msg.provider.connectionStatus) {
        setConnectionMessage(msg.provider.connectionStatus);
      }
      if (msg.type === 'bootstrap') setIndex(msg.index);
    }
  }, []);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      switch (msg.type) {
        case 'bootstrap':
        case 'settings':
          applyBootstrap(msg);
          break;
        case 'index.status':
          setIndex(msg.index);
          break;
        case 'run.started': {
          setRunning(true);
          setError(null);
          const userId = uid('user');
          const asstId = uid('asst');
          activeAssistantId.current = asstId;
          setTurns((prev) => [
            ...prev,
            { id: userId, role: 'user', text: msg.prompt, mode: msg.mode, activity: [] },
            {
              id: asstId,
              role: 'assistant',
              text: '',
              mode: msg.mode,
              streaming: true,
              activity: [],
            },
          ]);
          break;
        }
        case 'run.event': {
          const id = activeAssistantId.current;
          if (!id) break;
          setTurns((prev) =>
            prev.map((t) => {
              if (t.id !== id) return t;
              const nextActivity = [...t.activity];
              if (msg.event.kind === 'thinking' && ui.showReasoning) {
                const last = nextActivity[nextActivity.length - 1];
                if (last?.kind === 'thinking') {
                  const merged = {
                    ...last,
                    detail: `${last.detail ?? ''}${msg.event.detail ?? ''}`.slice(
                      -ui.reasoningPreviewMaxChars,
                    ),
                  };
                  nextActivity[nextActivity.length - 1] = merged;
                  return { ...t, activity: nextActivity };
                }
              }
              if (msg.event.kind === 'thinking' && !ui.showReasoning) {
                return t;
              }
              if (msg.event.kind === 'delta') {
                // Content previews stream into the assistant bubble via run.delta.
                return t;
              }
              nextActivity.push(msg.event);
              return { ...t, activity: nextActivity.slice(-40) };
            }),
          );
          break;
        }
        case 'run.delta': {
          const id = activeAssistantId.current;
          if (!id) break;
          setTurns((prev) =>
            prev.map((t) =>
              t.id === id ? { ...t, text: `${t.text}${msg.text}` } : t,
            ),
          );
          break;
        }
        case 'run.suspended': {
          const id = activeAssistantId.current;
          if (!id) break;
          setTurns((prev) =>
            prev.map((t) =>
              t.id === id ? { ...t, suspension: msg.suspension, streaming: false } : t,
            ),
          );
          break;
        }
        case 'run.result': {
          setRunning(false);
          const id = activeAssistantId.current;
          activeAssistantId.current = null;
          setTurns((prev) =>
            prev.map((t) => {
              if (!id || t.id !== id) return t;
              return {
                ...t,
                streaming: false,
                status: msg.status,
                route: msg.route,
                text: msg.answer?.trim()
                  ? msg.answer
                  : msg.error
                    ? `Error: ${msg.error}`
                    : t.text || `(${msg.status})`,
                suspension: undefined,
              };
            }),
          );
          break;
        }
        case 'run.cancelled':
          setRunning(false);
          break;
        case 'error':
          setError(msg.message);
          setRunning(false);
          break;
        case 'paths.results':
          if (msg.requestId === lastSearchId.current) {
            setSuggestions(msg.suggestions);
            setSuggestOpen(msg.suggestions.length > 0);
            setActiveSuggest(0);
          }
          break;
        case 'openSettings':
          setNav('settings');
          if (msg.tab) setSettingsTab(msg.tab);
          break;
        case 'provider.connectionResult':
          setTestingConnection(Boolean(msg.testing));
          setConnectionMessage(msg.message);
          if (msg.models?.length) {
            setProvider((p) => ({
              ...p,
              availableModels: mergeModelOptions(msg.models, p.model),
              connectionOk: msg.ok,
              connectionStatus: msg.message,
            }));
          } else if (!msg.testing) {
            setProvider((p) => ({
              ...p,
              connectionOk: msg.ok,
              connectionStatus: msg.message,
            }));
          }
          break;
        case 'tokenUsage':
          setTokenUsage(msg.usage);
          break;
        default:
          break;
      }
    });
    postToHost({ type: 'ready' });
    return off;
  }, [applyBootstrap, ui.reasoningPreviewMaxChars, ui.showReasoning]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, running]);

  const send = useCallback(() => {
    const text = prompt.trim();
    if (!text || running) return;
    postToHost({
      type: 'ask',
      prompt: text,
      mode,
      depth,
      pinnedPaths: pinned,
    });
    setPrompt('');
    setSuggestOpen(false);
  }, [prompt, running, mode, depth, pinned]);

  const onPromptChange = (value: string) => {
    setPrompt(value);
    const cursor = value.length;
    const before = value.slice(0, cursor);
    const match = before.match(/@([\w./_-]*)$/);
    if (match) {
      const q = match[1] ?? '';
      setSuggestQuery(q);
      const requestId = String(++searchReq.current);
      lastSearchId.current = requestId;
      postToHost({ type: 'paths.search', query: q, requestId });
    } else {
      setSuggestOpen(false);
    }
  };

  const insertMention = (path: string) => {
    const replaced = prompt.replace(/@([\w./_-]*)$/, `@${path} `);
    setPrompt(replaced);
    setPinned((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setSuggestOpen(false);
  };

  const saveProvider = () => {
    postToHost({
      type: 'settings.set',
      provider: {
        type: provider.type,
        baseUrl: provider.baseUrl,
        model: provider.model,
      },
    });
  };

  const testConnection = () => {
    setTestingConnection(true);
    setConnectionMessage('Testing…');
    postToHost({
      type: 'provider.testConnection',
      provider: {
        type: provider.type,
        baseUrl: provider.baseUrl,
        model: provider.model,
      },
    });
  };

  const onProviderTypeChange = (type: string) => {
    const preset = getProviderPreset(type);
    setProvider((p) => ({
      ...p,
      type,
      baseUrl: preset?.baseUrl ?? p.baseUrl,
      model: preset?.model ?? p.model,
      connectionOk: undefined,
      connectionStatus: undefined,
    }));
    setConnectionMessage(null);
    setCustomModel(false);
  };

  const modelOptions = useMemo(
    () => mergeModelOptions(provider.availableModels, provider.model),
    [provider.availableModels, provider.model],
  );

  const saveModel = (model: string) => {
    setProvider((p) => ({ ...p, model }));
    postToHost({
      type: 'settings.set',
      provider: { model },
    });
  };

  const saveUi = (patch: Partial<UiSettingsSnapshot>) => {
    const next = { ...ui, ...patch };
    setUi(next);
    if (patch.depth) setDepth(patch.depth);
    postToHost({ type: 'settings.set', ui: patch });
  };

  const saveMcp = (next: McpSettings) => {
    setMcp(next);
    postToHost({ type: 'settings.set', mcp: next });
  };

  const header = useMemo(
    () => (
      <header className="shell-header">
        <div className="brand">
          <div className="brand-mark">Mitii</div>
          <div className="brand-sub">Enterprise agent</div>
        </div>
        <nav className="nav-pills" aria-label="Primary">
          <button
            type="button"
            className={`nav-pill ${nav === 'chat' ? 'active' : ''}`}
            onClick={() => {
              setNav('chat');
              postToHost({ type: 'navigate', nav: 'chat' });
            }}
          >
            Chat
          </button>
          <button
            type="button"
            className={`nav-pill ${nav === 'settings' ? 'active' : ''}`}
            onClick={() => {
              setNav('settings');
              postToHost({ type: 'navigate', nav: 'settings', settingsTab });
            }}
          >
            Settings
          </button>
        </nav>
      </header>
    ),
    [nav, settingsTab],
  );

  return (
    <div className="app">
      {header}
      {error ? <div className="error-banner">{error}</div> : null}

      {nav === 'chat' ? (
        <div className="chat-view">
          <div className="messages">
            {turns.length === 0 ? (
              <div className="empty-state">
                <h2>Ready when you are</h2>
                <p>
                  Choose Ask, Plan, or Agent. Use @ to pin files. Watch thinking,
                  reading, and tools as they happen.
                </p>
              </div>
            ) : (
              turns.map((turn) => (
                <div key={turn.id} className="turn">
                  {turn.role === 'user' ? (
                    <>
                      <div className="meta-row">
                        <span>You</span>
                        {turn.mode ? <span>{turn.mode}</span> : null}
                      </div>
                      <div className="bubble user">{turn.text}</div>
                    </>
                  ) : (
                    <>
                      <div className="meta-row">
                        <span>Mitii</span>
                        {turn.status ? <span>{turn.status}</span> : null}
                        {turn.route ? <span>{turn.route}</span> : null}
                      </div>
                      {turn.activity.length > 0 ? (
                        <div className="activity">
                          <button
                            type="button"
                            className="activity-toggle"
                            onClick={() => setActivityOpen((v) => !v)}
                          >
                            {activityOpen ? 'Hide activity' : 'Show activity'} ·{' '}
                            {turn.activity.length}
                          </button>
                          {activityOpen
                            ? turn.activity.map((item) => (
                                <div
                                  key={item.id}
                                  className={`activity-item ${item.kind}`}
                                >
                                  <span className="activity-dot" />
                                  <div>
                                    <div className="activity-title">{item.title}</div>
                                    {item.detail ? (
                                      <div className="activity-detail">{item.detail}</div>
                                    ) : null}
                                  </div>
                                </div>
                              ))
                            : null}
                        </div>
                      ) : null}
                      {turn.text || turn.streaming ? (
                        <div
                          className={`bubble assistant ${turn.streaming ? 'streaming' : ''}`}
                        >
                          {turn.text || (turn.streaming ? 'Working…' : '')}
                        </div>
                      ) : null}
                      {turn.suspension ? (
                        <div className="card">
                          <h3>
                            {turn.suspension.kind === 'clarification_required'
                              ? 'Clarification needed'
                              : 'Approval required'}
                          </h3>
                          <p>
                            {turn.suspension.clarificationPrompt ??
                              turn.suspension.rationale ??
                              'Continue the run.'}
                          </p>
                          {turn.suspension.kind === 'clarification_required' ? (
                            <>
                              <textarea
                                rows={3}
                                value={clarifyText}
                                onChange={(e) => setClarifyText(e.target.value)}
                                placeholder="Your answer"
                              />
                              <div className="card-actions">
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => {
                                    postToHost({
                                      type: 'resume',
                                      runId: turn.suspension!.runId,
                                      clarificationAnswer: clarifyText,
                                    });
                                    setClarifyText('');
                                  }}
                                >
                                  Submit
                                </button>
                                <button
                                  type="button"
                                  className="btn ghost"
                                  onClick={() =>
                                    postToHost({
                                      type: 'resume',
                                      runId: turn.suspension!.runId,
                                    })
                                  }
                                >
                                  Stop
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="card-actions">
                              <button
                                type="button"
                                className="btn"
                                onClick={() =>
                                  postToHost({
                                    type: 'resume',
                                    runId: turn.suspension!.runId,
                                    approval: {
                                      approvalId: turn.suspension!.approval!.approvalId,
                                      decision: 'approved',
                                    },
                                  })
                                }
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="btn ghost"
                                onClick={() =>
                                  postToHost({
                                    type: 'resume',
                                    runId: turn.suspension!.runId,
                                    approval: {
                                      approvalId: turn.suspension!.approval!.approvalId,
                                      decision: 'denied',
                                    },
                                  })
                                }
                              >
                                Deny
                              </button>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <div className="composer-dock">
            {pinned.length > 0 ? (
              <div className="pins">
                {pinned.map((p) => (
                  <span key={p} className="pin-chip">
                    @{p}
                    <button
                      type="button"
                      aria-label={`Unpin ${p}`}
                      onClick={() => setPinned((prev) => prev.filter((x) => x !== p))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mode-switch" role="tablist" aria-label="Mode">
              {(['ask', 'plan', 'agent'] as AgentUiMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  className={`mode-btn ${mode === m ? 'active' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="mode-hint">{MODE_HINT[mode]}</div>

            <div className="composer-box">
              {suggestOpen ? (
                <div className="suggest-pop" role="listbox">
                  {suggestions.map((s, i) => (
                    <button
                      key={s.path}
                      type="button"
                      className={`suggest-item ${i === activeSuggest ? 'active' : ''}`}
                      onClick={() => insertMention(s.path)}
                    >
                      <span className="mono">@{s.path}</span>
                      <span className="suggest-kind">{s.kind}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea
                value={prompt}
                placeholder={`Message Mitii… type @ for context (${suggestQuery ? `filter: ${suggestQuery}` : 'files'})`}
                onChange={(e) => onPromptChange(e.target.value)}
                onKeyDown={(e) => {
                  if (suggestOpen && suggestions.length) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActiveSuggest((i) => (i + 1) % suggestions.length);
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActiveSuggest(
                        (i) => (i - 1 + suggestions.length) % suggestions.length,
                      );
                      return;
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      insertMention(suggestions[activeSuggest]!.path);
                      return;
                    }
                    if (e.key === 'Escape') {
                      setSuggestOpen(false);
                      return;
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <div className="composer-actions">
                <select
                  className="depth-select"
                  value={
                    customModel || !modelOptions.includes(provider.model)
                      ? '__custom__'
                      : provider.model
                  }
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === '__custom__') {
                      setCustomModel(true);
                      return;
                    }
                    setCustomModel(false);
                    saveModel(next);
                  }}
                  title="Model"
                  aria-label="Model"
                >
                  {modelOptions.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                  <option value="__custom__">Custom…</option>
                </select>
                {customModel || !modelOptions.includes(provider.model) ? (
                  <input
                    className="model-custom-input"
                    value={provider.model}
                    placeholder="model id"
                    onChange={(e) =>
                      setProvider((p) => ({ ...p, model: e.target.value }))
                    }
                    onBlur={() => {
                      if (provider.model.trim()) saveModel(provider.model.trim());
                    }}
                    title="Custom model id"
                  />
                ) : null}
                <select
                  className="depth-select"
                  value={depth}
                  onChange={(e) => {
                    const next = e.target.value as AgentUiDepth;
                    setDepth(next);
                    saveUi({ depth: next });
                  }}
                  title="Depth"
                >
                  <option value="auto">Auto</option>
                  <option value="quick">Quick</option>
                  <option value="deep">Deep</option>
                </select>
                <TokenMeter usage={tokenUsage} />
                {running ? (
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => postToHost({ type: 'cancel' })}
                  >
                    Stop
                  </button>
                ) : (
                  <button type="button" className="btn" onClick={send} disabled={!prompt.trim()}>
                    Send
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="settings-view">
          <div className="settings-tabs">
            {(
              [
                ['workspace', 'Workspace'],
                ['index', 'Index'],
                ['settings', 'Provider'],
                ['mcp', 'MCP'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`settings-tab ${settingsTab === id ? 'active' : ''}`}
                onClick={() => {
                  setSettingsTab(id);
                  postToHost({ type: 'navigate', nav: 'settings', settingsTab: id });
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {settingsTab === 'workspace' ? (
            <div className="settings-panel">
              <div className="stat">
                <div className="stat-label">Active workspace</div>
                <div className="mono" style={{ marginTop: 8 }}>
                  {workspace.displayRoot ?? 'No folder open'}
                </div>
              </div>
              <div className="field">
                <label htmlFor="override">Root path override</label>
                <input
                  id="override"
                  value={overrideDraft}
                  placeholder={workspace.root ?? '/path/to/repo'}
                  onChange={(e) => setOverrideDraft(e.target.value)}
                />
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    postToHost({
                      type: 'settings.set',
                      workspaceRootOverride: overrideDraft.trim() || null,
                    })
                  }
                >
                  Save override
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setOverrideDraft('');
                    postToHost({ type: 'settings.set', workspaceRootOverride: null });
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => postToHost({ type: 'openFolder' })}
                >
                  Open folder
                </button>
              </div>
            </div>
          ) : null}

          {settingsTab === 'index' ? (
            <div className="settings-panel">
              <div className="stat-grid">
                <div className="stat">
                  <div className="stat-value">{index.fileCount}</div>
                  <div className="stat-label">Indexed items</div>
                </div>
                <div className="stat">
                  <div className="stat-value" style={{ fontSize: 16 }}>
                    {index.readiness ?? '—'}
                  </div>
                  <div className="stat-label">Readiness</div>
                </div>
              </div>
              <p className="mono" style={{ color: 'var(--mitii-muted)', margin: 0 }}>
                {index.message ?? 'No index yet'}
                {index.truncated ? ' · truncated' : ''}
                {index.stateTokenPreview ? ` · token ${index.stateTokenPreview}…` : ''}
              </p>
              {index.lastIndexedAt ? (
                <p className="mono" style={{ color: 'var(--mitii-muted)', margin: 0 }}>
                  Last: {index.lastIndexedAt}
                </p>
              ) : null}
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  onClick={() => postToHost({ type: 'index.reindex' })}
                >
                  Reindex
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => postToHost({ type: 'index.refresh' })}
                >
                  Refresh
                </button>
              </div>
            </div>
          ) : null}

          {settingsTab === 'settings' ? (
            <div className="settings-panel">
              <div className="field">
                <label htmlFor="ptype">Provider</label>
                <select
                  id="ptype"
                  value={provider.type}
                  onChange={(e) => onProviderTypeChange(e.target.value)}
                >
                  {PROVIDER_OPTIONS.map((option) => (
                    <option key={option.type} value={option.type}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {provider.type === 'openai-compatible' ? (
                <div className="field">
                  <label htmlFor="base">Base URL</label>
                  <input
                    id="base"
                    value={provider.baseUrl}
                    placeholder="http://localhost:11434/v1"
                    onChange={(e) =>
                      setProvider((p) => ({ ...p, baseUrl: e.target.value }))
                    }
                  />
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="model">Model</label>
                <select
                  id="model"
                  value={
                    customModel || !modelOptions.includes(provider.model)
                      ? '__custom__'
                      : provider.model
                  }
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === '__custom__') {
                      setCustomModel(true);
                      return;
                    }
                    setCustomModel(false);
                    setProvider((p) => ({ ...p, model: next }));
                  }}
                >
                  {modelOptions.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                  <option value="__custom__">Custom…</option>
                </select>
                {customModel || !modelOptions.includes(provider.model) ? (
                  <input
                    style={{ marginTop: 8 }}
                    value={provider.model}
                    placeholder="custom model id"
                    onChange={(e) =>
                      setProvider((p) => ({ ...p, model: e.target.value }))
                    }
                  />
                ) : null}
                <span className="field-hint">
                  Use Test connection to refresh models from the endpoint.
                </span>
              </div>
              <div className="row">
                <span className="mono">
                  API key: {provider.hasApiKey ? 'configured' : 'not set'}
                </span>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => postToHost({ type: 'settings.setApiKey' })}
                >
                  Set key
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => postToHost({ type: 'settings.clearApiKey' })}
                >
                  Clear key
                </button>
              </div>
              {provider.type === 'openai-compatible' && !provider.hasApiKey ? (
                <p className="field-hint">
                  Local endpoints (Ollama / LM Studio) work without an API key.
                  Cloud endpoints need a key.
                </p>
              ) : null}
              <div className="row">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={testConnection}
                  disabled={testingConnection}
                >
                  {testingConnection ? 'Testing…' : 'Test connection'}
                </button>
                {connectionMessage || provider.connectionStatus ? (
                  <span
                    className={`settings-status-pill ${
                      provider.connectionOk
                        ? 'settings-status-pill--ok'
                        : provider.connectionOk === false
                          ? 'settings-status-pill--err'
                          : ''
                    }`}
                  >
                    {connectionMessage ?? provider.connectionStatus}
                  </span>
                ) : null}
              </div>
              <div className="field">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={ui.showReasoning}
                    onChange={(e) => saveUi({ showReasoning: e.target.checked })}
                  />
                  Show reasoning stream
                </label>
              </div>
              <div className="field">
                <label htmlFor="preview">Reasoning preview chars</label>
                <input
                  id="preview"
                  type="number"
                  min={500}
                  max={50000}
                  value={ui.reasoningPreviewMaxChars}
                  onChange={(e) =>
                    saveUi({
                      reasoningPreviewMaxChars: Number(e.target.value) || 8000,
                    })
                  }
                />
              </div>
              <div className="row">
                <button type="button" className="btn" onClick={saveProvider}>
                  Save provider
                </button>
              </div>
            </div>
          ) : null}

          {settingsTab === 'mcp' ? (
            <div className="settings-panel">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={mcp.enabled}
                  onChange={(e) =>
                    saveMcp({ ...mcp, enabled: e.target.checked })
                  }
                />
                Enable MCP servers
              </label>
              {mcp.servers.map((server, idx) => (
                <div key={`${server.name}-${idx}`} className="mcp-server">
                  <div className="field">
                    <label>Name</label>
                    <input
                      value={server.name}
                      onChange={(e) => {
                        const servers = mcp.servers.slice();
                        servers[idx] = { ...server, name: e.target.value };
                        setMcp({ ...mcp, servers });
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Transport</label>
                    <select
                      value={server.transport}
                      onChange={(e) => {
                        const servers = mcp.servers.slice();
                        servers[idx] = {
                          ...server,
                          transport: e.target.value as typeof server.transport,
                        };
                        setMcp({ ...mcp, servers });
                      }}
                    >
                      <option value="stdio">stdio</option>
                      <option value="sse">sse</option>
                      <option value="streamable-http">streamable-http</option>
                    </select>
                  </div>
                  {server.transport === 'stdio' ? (
                    <div className="field">
                      <label>Command</label>
                      <input
                        value={server.command ?? ''}
                        onChange={(e) => {
                          const servers = mcp.servers.slice();
                          servers[idx] = { ...server, command: e.target.value };
                          setMcp({ ...mcp, servers });
                        }}
                      />
                    </div>
                  ) : (
                    <div className="field">
                      <label>URL</label>
                      <input
                        value={server.url ?? ''}
                        onChange={(e) => {
                          const servers = mcp.servers.slice();
                          servers[idx] = { ...server, url: e.target.value };
                          setMcp({ ...mcp, servers });
                        }}
                      />
                    </div>
                  )}
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(server.disabled)}
                      onChange={(e) => {
                        const servers = mcp.servers.slice();
                        servers[idx] = { ...server, disabled: e.target.checked };
                        setMcp({ ...mcp, servers });
                      }}
                    />
                    Disabled
                  </label>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      const servers = mcp.servers.filter((_, i) => i !== idx);
                      setMcp({ ...mcp, servers });
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="row">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() =>
                    setMcp({
                      ...mcp,
                      servers: [
                        ...mcp.servers,
                        {
                          name: `server-${mcp.servers.length + 1}`,
                          transport: 'stdio',
                          command: '',
                        },
                      ],
                    })
                  }
                >
                  Add server
                </button>
                <button type="button" className="btn" onClick={() => saveMcp(mcp)}>
                  Save MCP
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
