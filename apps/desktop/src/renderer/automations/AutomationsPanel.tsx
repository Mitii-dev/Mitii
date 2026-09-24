/**
 * Automations workspace — flow tiles, canvas, and run log.
 *
 * Modules: Trigger, On commit, Command, Agent, plus MCP, skills, and recipes
 * from Desktop catalogs, each attached as its own canvas node.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  applyModuleDefToFlow,
} from '../../shared/automations/applyModule.js';
import {
  createEmptyFlow,
  materializeCatalogAttachments,
  type AutomationFlowDocument,
} from '../../shared/automations/flow.js';
import {
  moduleById,
  type AutomationModuleDef,
  type ConnectionId,
} from '../../shared/automations/modules.js';
import { ActivateModuleModal } from './ActivateModuleModal.js';
import { FlowCanvas, type CanvasSelection } from './FlowCanvas.js';
import { FlowInspector, type AutomationCatalog } from './FlowInspector.js';
import { FlowsGallery } from './FlowsGallery.js';
import { ModulePalette } from './ModulePalette.js';
import { RunInspector } from './RunInspector.js';
import { RunnerControlBar } from './RunnerControlBar.js';

export interface AutomationSpecView {
  specId: string;
  externalId?: string;
  title: string;
  enabled: boolean;
  triggerKind: string;
  scheduleExpr?: string | null;
  eventType?: string | null;
  nextRunAt?: string | null;
  autonomyPreset?: string | null;
  mode?: string | null;
}

export interface AutomationRunView {
  runId: string;
  specId: string;
  status: string;
  createdAt: string;
  error?: string | null;
  triggerKind?: string;
}

export interface AutomationRunnerView {
  running: boolean;
  workspaceRoot: string | null;
  webhookUrl: string | null;
  webhookPort: number | null;
  webhookTokenSet?: boolean;
  githubWebhookSecretSet?: boolean;
  startedAt: string | null;
  lastError: string | null;
  hooks?: {
    health: string | null;
    events: string | null;
    github: string | null;
  };
}

export interface AutomationTemplateView {
  id: string;
  title: string;
  description: string;
  category: string;
}

export interface ConnectionRecordView {
  id: ConnectionId;
  activated: boolean;
  activatedAt: string | null;
  meta?: Record<string, string>;
}

export interface AutomationsPanelProps {
  specs: AutomationSpecView[];
  runs: AutomationRunView[];
  runner?: AutomationRunnerView | null;
  templates?: AutomationTemplateView[];
  stats?: {
    specs: number;
    enabled: number;
    queued: number;
    running: number;
    done: number;
    failed: number;
  } | null;
  loading?: boolean;
  error?: string | null;
  saving?: boolean;
  connections?: ConnectionRecordView[];
  onRefresh: () => void;
  onTrigger: (specId: string) => void;
  onPause: (specId: string) => void;
  onResume: (specId: string) => void;
  onDelete?: (specId: string) => void;
  onLoadFlow?: (specId: string) => Promise<AutomationFlowDocument>;
  onSaveFlow?: (flow: AutomationFlowDocument) => Promise<void>;
  onApplyTemplate?: (templateId: string) => Promise<void>;
  onStartRunner?: (opts?: {
    webhookPort?: number;
    webhookToken?: string;
    githubWebhookSecret?: string;
    installGitHook?: boolean;
  }) => Promise<void>;
  onStopRunner?: () => Promise<void>;
  onOpenRun?: (runId: string) => void;
  onCancelRun?: (runId: string) => void;
  runDetail?: import('./RunInspector.js').AutomationRunDetailView | null;
  runDetailLoading?: boolean;
  runDetailError?: string | null;
  onCloseRunDetail?: () => void;
  ingressEvents?: Array<{
    eventId: string;
    eventType: string;
    source: string;
    processingStatus: string;
    occurredAt: string;
    matchedSpecCount: number;
    queuedRunCount: number;
  }>;
  gitHook?: import('./WebhookSetup.js').GitHookView | null;
  onInstallGitHook?: () => void;
  onUninstallGitHook?: () => void;
  onExport?: () => Promise<void>;
  onImportJson?: (payload: {
    specs: Array<Record<string, unknown>>;
  }) => Promise<void>;
  initialWebhookPort?: number;
  initialWebhookToken?: string;
  initialGithubSecret?: string;
  onActivateConnection?: (input: {
    id: ConnectionId;
    secrets: Record<string, string>;
    meta?: Record<string, string>;
  }) => Promise<ConnectionRecordView[]>;
  onDeactivateConnection?: (
    id: ConnectionId,
  ) => Promise<ConnectionRecordView[]>;
  onRefreshConnections?: () => void;
  catalog?: AutomationCatalog;
  workspaceRoot?: string;
}

type HomeTab = 'flows' | 'connections' | 'runs';

export function AutomationsPanel(props: AutomationsPanelProps) {
  const {
    specs,
    runs,
    runner,
    templates = [],
    stats,
    loading,
    error,
    saving,
    onRefresh,
    onTrigger,
    onPause,
    onResume,
    onDelete,
    onLoadFlow,
    onSaveFlow,
    onApplyTemplate,
    onStartRunner,
    onStopRunner,
    onOpenRun,
    onCancelRun,
    runDetail,
    runDetailLoading,
    runDetailError,
    onCloseRunDetail,
    onInstallGitHook,
    onExport,
    onImportJson,
    initialWebhookPort,
    initialWebhookToken,
    initialGithubSecret,
    onActivateConnection,
    catalog,
    workspaceRoot,
  } = props;

  const [homeTab, setHomeTab] = useState<HomeTab>('flows');
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [flow, setFlow] = useState<AutomationFlowDocument | null>(null);
  /** Spec id used for Trigger / Pause while editing (may differ from flow.id until save). */
  const [editingSpecId, setEditingSpecId] = useState<string | null>(null);
  const [selection, setSelection] = useState<CanvasSelection>(null);
  const [dirty, setDirty] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [runnerBusy, setRunnerBusy] = useState(false);
  const [triggerBusyId, setTriggerBusyId] = useState<string | null>(null);
  const [webhookPort, setWebhookPort] = useState(initialWebhookPort ?? 8787);
  const [webhookToken, setWebhookToken] = useState(initialWebhookToken ?? '');
  const [githubWebhookSecret, setGithubWebhookSecret] = useState(
    initialGithubSecret ?? '',
  );
  const [installGitHook] = useState(true);
  const [activateTarget, setActivateTarget] = useState<{
    connectionId: ConnectionId;
    module?: AutomationModuleDef | null;
    pendingModuleId?: string;
  } | null>(null);
  const [activateBusy, setActivateBusy] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof initialWebhookPort === 'number') setWebhookPort(initialWebhookPort);
  }, [initialWebhookPort]);
  useEffect(() => {
    if (typeof initialWebhookToken === 'string') setWebhookToken(initialWebhookToken);
  }, [initialWebhookToken]);
  useEffect(() => {
    if (typeof initialGithubSecret === 'string') {
      setGithubWebhookSecret(initialGithubSecret);
    }
  }, [initialGithubSecret]);

  const openNew = useCallback(() => {
    setFlow(createEmptyFlow());
    setEditingSpecId(null);
    setSelection({ kind: 'trigger' });
    setDirty(true);
    setView('editor');
    setEditorError(null);
  }, []);

  const openSpec = useCallback(
    async (specId: string) => {
      if (!onLoadFlow) return;
      setEditorError(null);
      try {
        const raw = await onLoadFlow(specId);
        const loaded = materializeCatalogAttachments(raw, {
          mcp: Object.fromEntries(
            (catalog?.mcpServers ?? []).map((item) => [item.id, item.name]),
          ),
          skill: Object.fromEntries(
            (catalog?.skills ?? []).map((item) => [item.id, item.title]),
          ),
          recipe: Object.fromEntries(
            (catalog?.recipes ?? []).map((item) => [item.id, item.title]),
          ),
        });
        setFlow(loaded);
        setEditingSpecId(specId);
        setSelection({ kind: 'trigger' });
        setDirty(loaded !== raw);
        setView('editor');
      } catch (err) {
        setEditorError(err instanceof Error ? err.message : String(err));
      }
    },
    [onLoadFlow, catalog],
  );

  const save = useCallback(async () => {
    if (!flow || !onSaveFlow) return;
    setEditorError(null);
    try {
      await onSaveFlow(flow);
      setEditingSpecId(flow.id);
      setDirty(false);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : String(err));
    }
  }, [flow, onSaveFlow]);

  const startRunner = useCallback(async () => {
    if (!onStartRunner) return;
    setRunnerBusy(true);
    try {
      await onStartRunner({
        webhookPort: webhookPort > 0 ? webhookPort : undefined,
        webhookToken: webhookToken.trim() || undefined,
        githubWebhookSecret: githubWebhookSecret.trim() || undefined,
        installGitHook,
      });
    } finally {
      setRunnerBusy(false);
    }
  }, [
    githubWebhookSecret,
    installGitHook,
    onStartRunner,
    webhookPort,
    webhookToken,
  ]);

  const stopRunner = useCallback(async () => {
    if (!onStopRunner) return;
    setRunnerBusy(true);
    try {
      await onStopRunner();
    } finally {
      setRunnerBusy(false);
    }
  }, [onStopRunner]);

  const triggerFlow = useCallback(
    (specId: string) => {
      setTriggerBusyId(specId);
      if (view !== 'editor') setHomeTab('runs');
      try {
        onTrigger(specId);
      } finally {
        window.setTimeout(() => setTriggerBusyId(null), 800);
      }
    },
    [onTrigger, view],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && view === 'editor') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, view]);

  const finishActivateAndMaybeApply = useCallback(
    async (input: {
      id: ConnectionId;
      secrets: Record<string, string>;
      meta?: Record<string, string>;
    }) => {
      if (!onActivateConnection) {
        setActivateError('Connection activation is not wired');
        return;
      }
      setActivateBusy(true);
      setActivateError(null);
      try {
        // Mirror GitHub webhook secret into runner prefs fields when present
        if (input.id === 'github' && input.secrets.webhookSecret) {
          setGithubWebhookSecret(input.secrets.webhookSecret);
        }
        await onActivateConnection(input);
        const pendingId = activateTarget?.pendingModuleId;
        const pendingMod = pendingId ? moduleById(pendingId) : null;
        setActivateTarget(null);
        if (pendingMod && flow && view === 'editor') {
          const applied = applyModuleDefToFlow({ flow, mod: pendingMod });
          if (applied) {
            setFlow(applied.flow);
            setSelection(applied.selection);
            setDirty(true);
          }
        }
      } catch (err) {
        setActivateError(err instanceof Error ? err.message : String(err));
      } finally {
        setActivateBusy(false);
      }
    },
    [activateTarget, flow, onActivateConnection, view],
  );

  if (view === 'editor' && flow) {
    const canTrigger = Boolean(editingSpecId) && !dirty;
    return (
      <div className="automations-panel automations-panel--editor">
        <header className="automations-panel__header">
          <div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm('Discard unsaved automation changes?')
                ) {
                  return;
                }
                setView('list');
                setHomeTab('flows');
                setFlow(null);
                setEditingSpecId(null);
              }}
            >
              ← Flows
            </button>
            <h2 className="automations-panel__title">
              {flow.title}
              {dirty ? ' ·' : ''}
            </h2>
            <p className="automations-panel__subtitle">
              Trigger → Command → Agent
            </p>
          </div>
          <div className="automations-panel__header-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canTrigger || triggerBusyId === editingSpecId}
              title={
                !editingSpecId
                  ? 'Save the flow first'
                  : dirty
                    ? 'Save before triggering'
                    : 'Manually queue this flow'
              }
              onClick={() => {
                if (editingSpecId) triggerFlow(editingSpecId);
              }}
            >
              {triggerBusyId === editingSpecId ? 'Triggering…' : 'Trigger'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || !dirty}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </header>
        <RunnerControlBar
          runner={runner}
          busy={runnerBusy}
          onStart={() => void startRunner()}
          onStop={() => void stopRunner()}
        />
        {editorError ? (
          <p className="automations-panel__error">{editorError}</p>
        ) : null}
        <div className="automations-editor automations-editor--with-palette">
          <ModulePalette
            catalog={catalog}
            flow={flow}
            onQuickAdd={(mod) => {
              const applied = applyModuleDefToFlow({ flow, mod });
              if (!applied) return;
              setFlow(applied.flow);
              setSelection(applied.selection);
              setDirty(true);
            }}
          />
          <div className="automations-editor__stage">
          <FlowCanvas
            flow={flow}
            selection={selection}
            nodeState={
              runDetail &&
              (runDetail.run.specId === editingSpecId ||
                runDetail.spec?.specId === editingSpecId)
                ? runDetail.live?.nodes
                : undefined
            }
            onSelect={setSelection}
            onChange={(next) => {
              setFlow(next);
              setDirty(true);
            }}
          />
          {runDetail &&
          (runDetail.run.specId === editingSpecId ||
            runDetail.spec?.specId === editingSpecId) ? (
            <div className="automations-editor__log">
              <RunInspector
                detail={runDetail}
                loading={runDetailLoading}
                error={runDetailError}
                onClose={() => onCloseRunDetail?.()}
                onCancel={onCancelRun}
              />
            </div>
          ) : null}
          </div>
          <FlowInspector
            flow={flow}
            selection={selection}
            catalog={catalog}
            workspaceRoot={workspaceRoot}
            onChange={(next) => {
              setFlow(next);
              setDirty(true);
            }}
          />
        </div>
        {activateTarget ? (
          <ActivateModuleModal
            connectionId={activateTarget.connectionId}
            busy={activateBusy}
            error={activateError}
            onCancel={() => setActivateTarget(null)}
            onActivate={(input) => void finishActivateAndMaybeApply(input)}
            onInstallLocalGit={() => {
              onInstallGitHook?.();
              void finishActivateAndMaybeApply({
                id: 'local_git',
                secrets: {},
              });
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="automations-panel">
      <header className="automations-panel__header">
        <div>
          <h2 className="automations-panel__title">Automations</h2>
          <p className="automations-panel__subtitle">
            Design a flow, start the runner, then trigger it. The agent runs
            the same way as chat.
          </p>
        </div>
        <div className="automations-panel__header-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onRefresh}
          >
            Refresh
          </button>
          {onExport ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void onExport()}
            >
              Export
            </button>
          ) : null}
          {onImportJson ? (
            <label className="btn btn-ghost automations-import-label">
              Import
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  void file.text().then((text) => {
                    try {
                      const parsed = JSON.parse(text) as {
                        specs?: Array<Record<string, unknown>>;
                      };
                      if (!Array.isArray(parsed.specs)) {
                        throw new Error('specs_array_required');
                      }
                      return onImportJson({ specs: parsed.specs });
                    } catch (err) {
                      window.alert(
                        err instanceof Error ? err.message : String(err),
                      );
                    }
                  });
                }}
              />
            </label>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={openNew}>
            New flow
          </button>
        </div>
      </header>

      {error ? <p className="automations-panel__error">{error}</p> : null}

      <RunnerControlBar
        runner={runner}
        busy={runnerBusy}
        onStart={() => void startRunner()}
        onStop={() => void stopRunner()}
      />

      <nav className="automations-tabs" aria-label="Automations sections">
        <button
          type="button"
          className={
            homeTab === 'flows'
              ? 'automations-tabs__tab automations-tabs__tab--active'
              : 'automations-tabs__tab'
          }
          onClick={() => setHomeTab('flows')}
        >
          Flows
          {stats ? ` (${stats.enabled}/${stats.specs})` : ''}
        </button>
        <button
          type="button"
          className={
            homeTab === 'runs'
              ? 'automations-tabs__tab automations-tabs__tab--active'
              : 'automations-tabs__tab'
          }
          onClick={() => setHomeTab('runs')}
        >
          Runs
          {stats ? ` (${stats.running} live)` : ''}
        </button>
      </nav>

      {homeTab === 'flows' ? (
        <FlowsGallery
          specs={specs}
          templates={templates}
          loading={loading}
          triggeringId={triggerBusyId}
          onOpen={(id) => void openSpec(id)}
          onNew={openNew}
          onTrigger={triggerFlow}
          onPause={onPause}
          onResume={onResume}
          onDelete={onDelete}
          onApplyTemplate={(id) => void onApplyTemplate?.(id)}
        />
      ) : null}

      {homeTab === 'runs' ? (
        <section className="automations-panel__section">
          {stats ? (
            <div className="automations-stats">
              <span>{stats.enabled} enabled</span>
              <span>{stats.queued} queued</span>
              <span>{stats.running} running</span>
              <span>{stats.done} done</span>
              <span>{stats.failed} failed</span>
            </div>
          ) : null}
          <h3 className="automations-panel__section-title">
            Recent runs ({runs.length})
          </h3>
          {runDetail || runDetailLoading ? (
            <RunInspector
              detail={runDetail ?? null}
              loading={runDetailLoading}
              error={runDetailError}
              onClose={() => onCloseRunDetail?.()}
              onCancel={onCancelRun}
            />
          ) : null}
          {runs.length === 0 ? (
            <p className="automations-panel__empty">No runs yet.</p>
          ) : (
            <ul className="run-list">
              {runs.map((run) => {
                const title =
                  specs.find((spec) => spec.specId === run.specId)?.title ??
                  'Automation';
                return (
                  <li key={run.runId}>
                    <button
                      type="button"
                      className="run-list__item"
                      onClick={() => onOpenRun?.(run.runId)}
                    >
                      <span
                        className={`automations-run-status automations-run-status--${run.status}`}
                      >
                        {run.status === 'done'
                          ? 'Completed'
                          : run.status === 'failed'
                            ? 'Failed'
                            : run.status === 'running'
                              ? 'Running'
                              : run.status === 'queued'
                                ? 'Queued'
                                : run.status}
                      </span>
                      <span className="run-list__title">{title}</span>
                      <span className="run-list__time">
                        {new Date(run.createdAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </button>
                    {run.error ? (
                      <p className="run-view__error">{run.error}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {activateTarget ? (
          <ActivateModuleModal
            connectionId={activateTarget.connectionId}
            busy={activateBusy}
            error={activateError}
          onCancel={() => setActivateTarget(null)}
          onActivate={(input) => void finishActivateAndMaybeApply(input)}
          onInstallLocalGit={() => {
            onInstallGitHook?.();
            void finishActivateAndMaybeApply({
              id: 'local_git',
              secrets: {},
            });
          }}
        />
      ) : null}
    </div>
  );
}
