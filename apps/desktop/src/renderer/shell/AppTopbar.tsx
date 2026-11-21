/** Top bar: layout toggle, run status, index chip and workspace / profile pickers. */

import logoUrl from '../assets/mitii-logo.svg';
import {
  IconChat,
  IconCode,
  IconUser,
  IconChevronDown,
  IconWorkspace,
  IconHistory,
  IconSun,
  IconMoon,
} from './ActivityIcons.js';
import { IndexStatusChip } from '../indexing/IndexStatusChip.js';
import { workspaceLabel } from '../api.js';
import type { AppModel } from '../app/useAppModel.js';

export function AppTopbar({ m }: { m: AppModel }) {
  const {
    view,
    chatLayout,
    setLayout,
    inCodeMode,
    busy,
    setView,
    setWorkspaceSide,
    indexStatus,
    indexIndexing,
    indexEmbeddingBg,
    indexProgress,
    indexStream,
    snapshot,
    settings,
    runReindex,
    pauseIndex,
    setSettingsTab,
    setFeatureTab,
    picker,
    setPicker,
    activeProfile,
    historyMenuRef,
    historyMenuOpen,
    setHistoryMenuOpen,
    recentHistory,
    threadId,
    onOpenThread,
    hasMoreHistory,
    theme,
    toggleTheme,
  } = m;

  return (
    <header className="app-topbar">
      <div className="app-topbar__left">
        <div className="app-topbar__brand" title="Mitii">
          <img src={logoUrl} alt="" width={22} height={22} />
          <span className="app-topbar__brand-name">Mitii</span>
        </div>
        <span className="app-topbar__divider" aria-hidden />
        <div className="layout-toggle" role="group" aria-label="Layout">
          <button
            type="button"
            className={
              view === 'chat' && chatLayout === 'chat' ? 'is-active' : undefined
            }
            onClick={() => setLayout('chat')}
          >
            <IconChat size={15} />
            Chat
          </button>
          <button
            type="button"
            className={inCodeMode ? 'is-active' : undefined}
            onClick={() => setLayout('code')}
          >
            <IconCode size={15} />
            Code
          </button>
        </div>
      </div>
      <div className="app-topbar__right">
        {busy ? (
          <button
            type="button"
            className="run-status-chip"
            title="Agent is running — click to return to chat"
            onClick={() => {
              setView('chat');
              setWorkspaceSide('explorer');
            }}
          >
            <span className="run-status-chip__dot" aria-hidden />
            Running
          </button>
        ) : null}
        <IndexStatusChip
          index={indexStatus}
          indexing={indexIndexing}
          embeddingBackground={indexEmbeddingBg}
          progressPercent={indexProgress}
          streamLines={indexStream}
          workspaceLabel={workspaceLabel(snapshot?.workspaceRoot ?? '')}
          embeddingSource={settings.semanticIndex.source}
          onReindex={(opts) => void runReindex(opts)}
          onPause={() => void pauseIndex()}
          onOpenSettings={() => {
            setSettingsTab('features');
            setFeatureTab('index');
            setView('settings');
          }}
        />
        <div className="status-icons status-icons--identity">
          <div className="top-select">
            <button
              type="button"
              className="top-select__trigger"
              disabled={busy}
              title={busy ? 'Agent is running' : 'Profile'}
              aria-expanded={picker === 'profile'}
              onClick={() =>
                setPicker((v) => (v === 'profile' ? null : 'profile'))
              }
            >
              <IconUser size={14} />
              <span className="top-select__label">Profile</span>
              <span className="top-select__value">
                {activeProfile?.name ?? 'Default'}
              </span>
              <IconChevronDown
                className="top-select__chevron"
                size={11}
              />
            </button>
          </div>
          <div className="top-workspace-cluster">
            <div className="top-select">
              <button
                type="button"
                className="top-select__trigger top-select__trigger--repo"
                disabled={busy}
                aria-expanded={picker === 'workspace'}
                title={
                  busy
                    ? 'Agent is running'
                    : (snapshot?.workspaceRoot ?? 'Workspace')
                }
                onClick={() =>
                  setPicker((v) => (v === 'workspace' ? null : 'workspace'))
                }
              >
                <IconWorkspace size={14} />
                <span className="top-select__label">Workspace</span>
                <span className="top-select__value">
                  {workspaceLabel(snapshot?.workspaceRoot ?? '') ||
                    'Select folder'}
                </span>
                <IconChevronDown
                  className="top-select__chevron"
                  size={11}
                />
              </button>
            </div>
            {inCodeMode ? (
              <div className="top-history" ref={historyMenuRef}>
                <button
                  type="button"
                  className="top-icon-btn"
                  disabled={busy}
                  title={busy ? 'Agent is running' : 'Recent chats'}
                  aria-label={busy ? 'Agent is running' : 'Recent chats'}
                  aria-expanded={historyMenuOpen}
                  onClick={() => setHistoryMenuOpen((v) => !v)}
                >
                  <IconHistory size={15} />
                </button>
                {historyMenuOpen ? (
                  <div className="top-history__menu" role="menu">
                    {recentHistory.length === 0 ? (
                      <p className="top-history__empty">No chats yet</p>
                    ) : (
                      recentHistory.map((thread) => (
                        <button
                          key={thread.id}
                          type="button"
                          role="menuitem"
                          className={
                            thread.id === threadId ? 'is-active' : undefined
                          }
                          onClick={() => {
                            setHistoryMenuOpen(false);
                            void onOpenThread(thread.id);
                          }}
                        >
                          {thread.title || 'Chat'}
                        </button>
                      ))
                    )}
                    {hasMoreHistory ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="top-history__more"
                        onClick={() => {
                          setHistoryMenuOpen(false);
                          setLayout('chat');
                        }}
                      >
                        More…
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="top-icon-btn"
              title={
                theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
              }
              aria-label={
                theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
              }
              onClick={toggleTheme}
            >
              {theme === 'dark' ? (
                <IconSun size={15} />
              ) : (
                <IconMoon size={15} />
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
