import { type CSSProperties } from 'react';
import { type AppApi } from '../app/appApi';
import { postToHost } from '../bridge';
import { ContextPanel } from '../components/ContextPanel';
import { DatabaseModeBanner } from '../components/DatabaseModeBanner';
import { McpPinChips } from '../components/McpPinChips';
import { PlanFollowStrip } from '../components/PlanPanel';
import { ComposerCodeReviewRow } from '../containers/ComposerCodeReviewRow';
import { ComposerFooter } from '../containers/ComposerFooter';
import { ComposerSuggestPopover } from '../containers/ComposerSuggestPopover';
import { modeColor } from '../modeColors';
import { ComposerReviewStrip } from '../review/ComposerReviewStrip';
import { PendingPlanBanner } from '@mitii/ui-react';

export function ComposerDock({ api }: { api: AppApi }) {
  const {
    activeSuggest,
    allSuggestItems,
    currentModeColor,
    dismissFileChanges,
    dismissReviewFindings,
    dismissedAutoPinsRef,
    executePendingPlan,
    filteredMcpSuggestions,
    filteredSkillSuggestions,
    fixReviewFindings,
    followingPlan,
    index,
    insertMention,
    mode,
    onPromptChange,
    openFile,
    pendingPlan,
    pinned,
    pinnedMcpServerIds,
    pinnedSkillIds,
    plan,
    prompt,
    promptTextareaRef,
    review,
    reviewBarExpandToken,
    reviewFindings,
    runCodeReview,
    running,
    selectMcp,
    selectSkill,
    send,
    setActiveSuggest,
    setPendingPlan,
    setPinned,
    setPinnedMcpServerIds,
    setPinnedSkillIds,
    setPlan,
    setSuggestOpen,
    showGitChanges,
    suggestKind,
    suggestOpen,
    suggestions,
    turns,
    ui,
    undoFileChanges,
  } = api;

  return (
    <div
      className="composer-dock"
      style={
        {
          '--composer-mode-color': currentModeColor,
        } as CSSProperties
      }
    >
      <PendingPlanBanner
        visible={Boolean(pendingPlan) && mode !== 'agent'}
        onExecuteInAgent={executePendingPlan}
        onDismiss={() => {
          setPendingPlan(null);
          setPlan(null);
          postToHost({ type: 'clearPendingPlan' });
        }}
      />
      <DatabaseModeBanner visible={mode === 'database'} />
      {followingPlan ? (
        <PlanFollowStrip
          plan={plan}
          running={running}
          onOpenPlanFile={openFile}
        />
      ) : null}

      <ComposerCodeReviewRow api={api} />

      <div className="composer-box">
        <ComposerReviewStrip
          review={review}
          findings={reviewFindings}
          turns={turns}
          running={running}
          expandSignal={reviewBarExpandToken}
          codeReviewEnabled={ui.features.codeReviewButton === true}
          onRefresh={() => postToHost({ type: 'refreshReviewDiff' })}
          onOpenFile={openFile}
          onOpenDiff={(path) =>
            postToHost({ type: 'reviewWorkspaceFile', path })
          }
          onOpenFinding={(path, line) =>
            postToHost({ type: 'openFile', path, line })
          }
          onShowChanges={showGitChanges}
          onRunCodeReview={() => runCodeReview()}
          onUndoFileChanges={undoFileChanges}
          onDismissFileChanges={dismissFileChanges}
          onDismissFindings={dismissReviewFindings}
          onFixAllFindings={() => fixReviewFindings()}
          onFixFinding={(index) => fixReviewFindings([index])}
        />
        <ContextPanel
          pins={pinned}
          modeColor={currentModeColor}
          onRemove={(path) => {
            dismissedAutoPinsRef.current.add(path);
            setPinned((prev) => prev.filter((x) => x.path !== path));
          }}
          onClear={() => {
            for (const pin of pinned) {
              dismissedAutoPinsRef.current.add(pin.path);
            }
            setPinned([]);
          }}
          onPick={() => postToHost({ type: 'pickContextPath' })}
          onKeep={(path) => {
            dismissedAutoPinsRef.current.delete(path);
            setPinned((prev) =>
              prev.map((p) =>
                p.path === path ? { ...p, source: 'user' } : p,
              ),
            );
          }}
        />
        {pinnedSkillIds.length > 0 ? (
          <div className="skill-pin-row">
            {pinnedSkillIds.map((skillId) => (
              <span key={skillId} className="skill-pin-chip mono">
                @skill:{skillId}
                <button
                  type="button"
                  aria-label={`Remove skill ${skillId}`}
                  onClick={() =>
                    setPinnedSkillIds((prev) =>
                      prev.filter((id) => id !== skillId),
                    )
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <McpPinChips
          pinnedIds={pinnedMcpServerIds}
          onRemove={(serverId) =>
            setPinnedMcpServerIds((prev) =>
              prev.filter((id) => id !== serverId),
            )
          }
        />
        <ComposerSuggestPopover api={api} />
        <textarea
          ref={promptTextareaRef}
          rows={1}
          value={prompt}
          placeholder="Message Mitii... @ for files, skills, MCP"
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={(e) => {
            const activeSuggestions =
              suggestKind === 'skill'
                ? filteredSkillSuggestions
                : suggestKind === 'mcp'
                  ? filteredMcpSuggestions
                  : suggestKind === 'all'
                    ? allSuggestItems
                    : suggestions;
            if (suggestOpen && activeSuggestions.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveSuggest(
                  (i) => (i + 1) % activeSuggestions.length,
                );
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveSuggest(
                  (i) =>
                    (i - 1 + activeSuggestions.length) %
                    activeSuggestions.length,
                );
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                if (suggestKind === 'skill') {
                  selectSkill(
                    filteredSkillSuggestions[activeSuggest]!.id,
                  );
                } else if (suggestKind === 'mcp') {
                  selectMcp(filteredMcpSuggestions[activeSuggest]!.id);
                } else if (suggestKind === 'all') {
                  const item = allSuggestItems[activeSuggest]!;
                  if (item.type === 'skill') {
                    selectSkill(item.id.slice('skill:'.length));
                  } else if (item.type === 'mcp') {
                    selectMcp(item.id.slice('mcp:'.length));
                  } else {
                    insertMention(item.id.slice('path:'.length));
                  }
                } else {
                  insertMention(suggestions[activeSuggest]!.path);
                }
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
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
        <ComposerFooter api={api} />
      </div>
    </div>
  );
}
