/** Main surface: workspace panel, chat panel and settings layer. */

import { WorkspacePanel } from './WorkspacePanel.js';
import { getDesktopBridge } from '../api.js';
import { ResizeHandle } from './ResizeHandle.js';
import { SettingsPanel } from '../settings/SettingsPanel.js';
import type { AppModel } from '../app/useAppModel.js';
import { ChatPanel } from '../chat/ChatPanel.js';

export function MainSection({ m }: { m: AppModel }) {
  const {
    settingsOpen,
    chatLayout,
    hideCodeChat,
    engine,
    snapshot,
    workspaceSide,
    setWorkspaceSide,
    setGitBadge,
    openPathRequest,
    setOpenPathRequest,
    workspaceInvalidate,
    setEditorContext,
    onFileSavedDebounced,
    busy,
    codeReviewEnabled,
    setReviewFindings,
    setReviewDismissed,
    setInput,
    setMode,
    setView,
    setLayout,
    refresh,
    activeProfile,
    activeProfileId,
    setSettingsTab,
    codeChatWidth,
    setCodeChatWidth,
    settings,
    settingsBusy,
    settingsTab,
    featureTab,
    setFeatureTab,
    onSaveSettings,
    onPickWorkspace,
    setIndexIndexing,
    setIndexProgress,
    setIndexStream,
    pushIndexStream,
    refreshIndexStatus,
  } = m;

  return (
    <section className={`main${settingsOpen ? ' main--settings' : ''}`}>
      <div
        className="main-surface"
        aria-hidden={settingsOpen || undefined}
      >
        {chatLayout === 'code' ? (
          <div
            className={`code-mode${
              hideCodeChat ? ' code-mode--extensions' : ''
            }`}
          >
            <div className="code-mode__workspace">
              {engine ? (
                <WorkspacePanel
                  key={snapshot?.workspaceRoot ?? 'workspace'}
                  baseUrl={engine.baseUrl}
                  token={engine.token}
                  workspaceRoot={snapshot?.workspaceRoot ?? ''}
                  embedded
                  hideActivityRail
                  side={workspaceSide}
                  onSideChange={setWorkspaceSide}
                  onGitCountChange={setGitBadge}
                  openPathRequest={openPathRequest}
                  onOpenPathHandled={() => setOpenPathRequest(null)}
                  workspaceInvalidate={workspaceInvalidate}
                  onEditorContextChange={setEditorContext}
                  onFileSaved={onFileSavedDebounced}
                  agentBusy={busy}
                  showCodeReview={codeReviewEnabled}
                  onReviewFindingsChange={(findings) => {
                    if (!codeReviewEnabled) return;
                    setReviewFindings(findings);
                    setReviewDismissed(false);
                  }}
                  onUsePrompt={(prompt, nextMode) => {
                    setInput(prompt);
                    if (nextMode) setMode(nextMode);
                    setView('chat');
                    setLayout('code');
                    setWorkspaceSide('explorer');
                  }}
                  onRestartEngine={async () => {
                    const bridge = getDesktopBridge();
                    if (!bridge) return;
                    await bridge.restartEngine();
                    await refresh();
                  }}
                  activeProfileName={activeProfile?.name ?? null}
                  hasActiveProfile={Boolean(activeProfileId && activeProfile)}
                  onOpenProfiles={() => {
                    setView('settings');
                    setSettingsTab('profiles');
                  }}
                />
              ) : (
                <div className="workspace-hero">
                  <h2>Repository</h2>
                  <p>Engine is starting…</p>
                </div>
              )}
            </div>
            <ResizeHandle
              value={codeChatWidth}
              onChange={setCodeChatWidth}
              min={280}
              max={720}
              reverse
              label="Resize chat panel"
            />
            <div
              className="code-mode__chat"
              style={{ width: codeChatWidth, flex: '0 0 auto' }}
              aria-hidden={hideCodeChat}
            >
              <ChatPanel m={m} />
            </div>
          </div>
        ) : (
          <ChatPanel m={m} />
        )}
      </div>
      {settingsOpen ? (
        <div className="settings-layer">
          <SettingsPanel
            key={snapshot?.workspaceRoot ?? 'settings'}
            settings={settings}
            workspaceRoot={snapshot?.workspaceRoot ?? ''}
            hasApiKey={snapshot?.hasApiKey ?? false}
            hasSearchApiKey={snapshot?.hasSearchApiKey ?? false}
            busy={settingsBusy}
            engineBaseUrl={snapshot?.engineBaseUrl}
            authToken={snapshot?.authToken}
            tab={settingsTab}
            onTabChange={setSettingsTab}
            featureTab={featureTab}
            onFeatureTabChange={setFeatureTab}
            hideSideNav
            onSave={onSaveSettings}
            onPickWorkspace={() => void onPickWorkspace()}
            onIndexStarted={() => {
              setIndexIndexing(true);
              setIndexProgress(8);
              setIndexStream([]);
              pushIndexStream('Reindex started from settings…');
            }}
            onIndexChanged={() => {
              pushIndexStream('Index status updated');
              void refreshIndexStatus();
            }}
            onWorkspaceCacheCleared={() => {
              void refresh();
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
