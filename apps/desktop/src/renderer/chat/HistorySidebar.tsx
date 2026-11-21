/** Chat-layout history sidebar. */

import { ChatHistoryNav } from './ChatHistoryNav.js';
import { ResizeHandle } from '../shell/ResizeHandle.js';
import type { AppModel } from '../app/useAppModel.js';

export function HistorySidebar({ m }: { m: AppModel }) {
  const {
    showHistorySide,
    sideWidth,
    snapshot,
    history,
    threadId,
    busy,
    historyLoading,
    activeProfile,
    onOpenThread,
    onDeleteThread,
    onNewChat,
    setPicker,
    setLayout,
    setWorkspaceSide,
    setView,
    setSideWidth,
  } = m;

  return showHistorySide ? (
    <>
      <aside className="side" style={{ width: sideWidth, flex: '0 0 auto' }}>
        <ChatHistoryNav
          workspaceRoot={snapshot?.workspaceRoot}
          threads={history.map((t) => ({
            id: t.id,
            title: t.title,
            updatedAt: t.updatedAt,
          }))}
          activeThreadId={threadId}
          busy={busy}
          loading={historyLoading}
          profileName={activeProfile?.name}
          onOpenThread={(id) => void onOpenThread(id)}
          onDeleteThread={(id) => void onDeleteThread(id)}
          onNewChat={() => void onNewChat()}
          onOpenWorkspace={() =>
            setPicker((v) => (v === 'workspace' ? null : 'workspace'))
          }
          onOpenSkills={() => {
            setLayout('code');
            setWorkspaceSide('skills');
          }}
          onOpenSettings={() => setView('settings')}
          onOpenProfile={() =>
            setPicker((v) => (v === 'profile' ? null : 'profile'))
          }
        />
      </aside>
      <ResizeHandle
        value={sideWidth}
        onChange={setSideWidth}
        min={160}
        max={420}
        label="Resize chat list"
      />
    </>
  ) : null;
}
