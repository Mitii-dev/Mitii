/** Composer dock: plan banner, review strip, input and controls. */

import {
  ComposerControls,
  ModelQuickSelect,
  PendingPlanBanner,
  TokenMeter,
} from '@mitii/ui-react';
import { DatabaseModeBanner, isDatabaseMcpServer } from './DatabaseModeBanner.js';
import { PlanFollowStrip } from './PlanFollowStrip.js';
import { ComposerReviewStrip } from './ComposerReviewStrip.js';
import { fetchCheckpoints, restoreCheckpoint, shortPath } from '../api.js';
import { type CSSProperties } from 'react';
import type { AppModel } from '../app/useAppModel.js';
import { SuggestMenu } from './SuggestMenu.js';

export function ChatComposer({ m }: { m: AppModel }) {
  const {
    pendingPlan,
    mode,
    suspension,
    busy,
    executePendingPlan,
    dismissPendingPlan,
    mcpStatusReady,
    mcpMasterEnabled,
    mcpServers,
    dbAccess,
    setLayout,
    setWorkspaceSide,
    planFollowView,
    setOpenPathRequest,
    showComposerReview,
    activeReviewFindings,
    latestFileChanges,
    latestReviewRunId,
    setPinnedPaths,
    engine,
    setError,
    setSettingsTab,
    setView,
    setReviewDismissed,
    setReviewFindings,
    setMessages,
    latestAssistantWithChanges,
    onSubmit,
    pinMenuRef,
    accent,
    hasPins,
    pinnedPaths,
    pinnedSkillIds,
    toggleSkillPin,
    pinnedMcpIds,
    toggleMcpPin,
    textareaRef,
    input,
    snapshot,
    setInput,
    updateMentionFromInput,
    pinMenu,
    suggestItems,
    setSuggestIndex,
    suggestIndex,
    applySuggestItem,
    closeSuggest,
    openAtSuggest,
    approvalMode,
    thoroughness,
    onModeChange,
    setApprovalMode,
    setDbAccess,
    ensureDatabaseAccessReady,
    setThoroughness,
    stopRun,
    tokenUsage,
    costRates,
    modelLabel,
    knownModels,
    modelsLoading,
    onSelectModel,
    refreshModelsForActiveProfile,
  } = m;

  return (
    <div className="composer-dock">
      <PendingPlanBanner
        visible={
          Boolean(pendingPlan) &&
          mode === 'plan' &&
          suspension?.kind !== 'plan_approval_required'
        }
        busy={busy}
        description="Execute in Agent to implement it."
        onExecuteInAgent={executePendingPlan}
        onDismiss={dismissPendingPlan}
      />
      <DatabaseModeBanner
        visible={mode === 'database'}
        status={
          !mcpStatusReady
            ? 'loading'
            : !mcpMasterEnabled
              ? 'mcp_disabled'
              : mcpServers.some(
                    (s) => s.enabled && isDatabaseMcpServer(s),
                  )
                ? 'connected'
                : 'disconnected'
        }
        servers={mcpServers
          .filter((s) => s.enabled && isDatabaseMcpServer(s))
          .map((s) => ({ id: s.id, name: s.name }))}
        dbAccess={dbAccess}
        onOpenMcp={() => {
          setLayout('code');
          setWorkspaceSide('mcp');
        }}
      />
      <PlanFollowStrip
        plan={
          pendingPlan && (mode === 'plan' || mode === 'agent')
            ? planFollowView
            : null
        }
        running={busy && (mode === 'plan' || mode === 'agent')}
        onOpenPlanFile={(path) => {
          setLayout('code');
          setWorkspaceSide('explorer');
          setOpenPathRequest({ path, view: 'file' });
        }}
      />
      {showComposerReview ? (
        <ComposerReviewStrip
          findings={activeReviewFindings}
          fileChangeCount={latestFileChanges?.files.length ?? 0}
          files={latestFileChanges?.files ?? []}
          runId={latestReviewRunId}
          totalAdditions={latestFileChanges?.totalAdditions ?? 0}
          totalDeletions={latestFileChanges?.totalDeletions ?? 0}
          running={busy}
          onShowChanges={() => {
            setLayout('code');
            setWorkspaceSide('git');
            const first = latestFileChanges?.files[0]?.path;
            if (first) {
              setOpenPathRequest({ path: first, view: 'diff' });
            }
          }}
          onOpenFile={(path) => {
            setLayout('code');
            setWorkspaceSide('git');
            setOpenPathRequest({ path, view: 'diff' });
            setPinnedPaths((prev) =>
              prev.includes(path) ? prev : [...prev, path].slice(0, 32),
            );
          }}
          onUndoChanges={(runId) => {
            void (async () => {
              if (!engine) {
                setError(
                  'Engine offline — open Settings → Context → Checkpoints to restore.',
                );
                return;
              }
              try {
                const checkpoints = await fetchCheckpoints(engine);
                const match =
                  checkpoints.find(
                    (cp) =>
                      cp.id === runId ||
                      cp.label.includes(runId) ||
                      (cp.changedPaths ?? []).some((p) =>
                        (latestFileChanges?.files ?? []).some(
                          (f) => f.path === p,
                        ),
                      ),
                  ) ?? checkpoints[0];
                if (!match) {
                  setError(
                    'No checkpoint available — use Settings → Context → Checkpoints to restore.',
                  );
                  setSettingsTab('context');
                  setView('settings');
                  return;
                }
                await restoreCheckpoint({ ...engine, id: match.id });
                setReviewDismissed(true);
                setReviewFindings([]);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === latestAssistantWithChanges?.id
                      ? { ...m, fileChanges: undefined }
                      : m,
                  ),
                );
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : String(err),
                );
              }
            })();
          }}
          onFixAll={() => {
            const open = activeReviewFindings.filter(
              (f) => (f as { status?: string }).status !== 'fixed',
            );
            const listing =
              open.length > 0
                ? open
                    .map(
                      (f, i) =>
                        `${i + 1}. ${f.path}${f.startLine ? `:${f.startLine}` : ''} — ${f.content}`,
                    )
                    .join('\n')
                : '(no structured findings — fix issues in the latest file changes)';
            void onSubmit({
              prompt: `Fix all open code-review findings:\n${listing}`,
              mode: 'agent',
            });
          }}
          onDismiss={() => {
            setReviewFindings([]);
            setReviewDismissed(true);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === latestAssistantWithChanges?.id
                  ? { ...m, fileChanges: undefined }
                  : m,
              ),
            );
          }}
        />
      ) : null}
      <form
        className="composer-box"
        ref={pinMenuRef}
        style={{ '--composer-mode-color': accent } as CSSProperties}
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <SuggestMenu m={m} />
        {hasPins ? (
          <div className="composer-pins">
            {pinnedPaths.map((path) => (
              <span key={`path:${path}`} className="pin-chip">
                {shortPath(path)}
                <button
                  type="button"
                  aria-label={`Unpin ${path}`}
                  disabled={busy}
                  onClick={() =>
                    setPinnedPaths((prev) => prev.filter((p) => p !== path))
                  }
                >
                  ×
                </button>
              </span>
            ))}
            {pinnedSkillIds.map((id) => (
              <span key={`skill:${id}`} className="pin-chip">
                {`@skill:${id}`}
                <button
                  type="button"
                  aria-label={`Unpin skill ${id}`}
                  disabled={busy}
                  onClick={() => toggleSkillPin(id)}
                >
                  ×
                </button>
              </span>
            ))}
            {pinnedMcpIds.map((id) => (
              <span key={`mcp:${id}`} className="pin-chip">
                {`@mcp:${id}`}
                <button
                  type="button"
                  aria-label={`Unpin MCP ${id}`}
                  disabled={busy}
                  onClick={() => toggleMcpPin(id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={input}
          disabled={busy || !snapshot}
          placeholder="Message Mitii…  @ to attach files, folders, skills, MCP"
          rows={1}
          onChange={(e) => {
            const next = e.target.value;
            setInput(next);
            updateMentionFromInput(next);
          }}
          onKeyDown={(e) => {
            if (pinMenu && suggestItems.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSuggestIndex((i) => (i + 1) % suggestItems.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSuggestIndex(
                  (i) => (i - 1 + suggestItems.length) % suggestItems.length,
                );
                return;
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                const item = suggestItems[suggestIndex];
                if (item) {
                  e.preventDefault();
                  applySuggestItem(item);
                  return;
                }
              }
            }
            if (e.key === 'Escape' && pinMenu) {
              e.preventDefault();
              closeSuggest();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onSubmit();
            }
          }}
        />
        <div className="composer-footer">
          <div className="composer-controls-row">
            <div className="composer-attach">
              <button
                type="button"
                className={`composer-attach__symbol${
                  pinMenu ? ' is-open' : ''
                }`}
                disabled={busy || !snapshot}
                aria-label="Attach context, skills, or MCP"
                aria-haspopup="listbox"
                aria-expanded={pinMenu}
                title="@ Attach"
                onClick={() => openAtSuggest()}
              >
                @
              </button>
            </div>
            <ComposerControls
              mode={mode}
              approvalMode={approvalMode}
              dbAccess={dbAccess}
              thoroughness={thoroughness}
              disabled={busy}
              onModeChange={onModeChange}
              onApprovalModeChange={setApprovalMode}
              onDbAccessChange={(next) => {
                setDbAccess(next);
                void ensureDatabaseAccessReady(next).catch((err: unknown) => {
                  setError(
                    err instanceof Error ? err.message : String(err),
                  );
                });
              }}
              onThoroughnessChange={setThoroughness}
            />
            <div className="composer-actions">
              {busy ? (
                <button
                  type="button"
                  className="composer-send composer-send--stop"
                  title="Stop"
                  aria-label="Stop"
                  onClick={stopRun}
                >
                  <svg
                    className="composer-send__icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden
                  >
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  className="composer-send"
                  style={
                    {
                      '--composer-control-color': accent,
                    } as CSSProperties
                  }
                  disabled={!input.trim()}
                  title="Send"
                  aria-label="Send"
                >
                  <svg
                    className="composer-send__icon"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M12 19V5" />
                    <path d="m5 12 7-7 7 7" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <div className="composer-meta-row">
            <TokenMeter
              usage={tokenUsage}
              costRates={costRates}
              reportedLabel="Session"
              liveStatsLayout="full"
            />
            <ModelQuickSelect
              model={modelLabel}
              models={knownModels}
              loading={modelsLoading}
              disabled={busy}
              onChange={(next) => void onSelectModel(next)}
              onOpen={() => {
                void refreshModelsForActiveProfile();
              }}
              onEditProfile={() => {
                setSettingsTab('profiles');
                setView('settings');
              }}
            />
          </div>
        </div>
      </form>
    </div>
  );
}
