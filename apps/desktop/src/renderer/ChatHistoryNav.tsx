/**
 * Chat sidebar for the active workspace only (single-project mode).
 */

import { IconPlus, IconSwitch } from './ActivityIcons.js';
import { workspaceLabel } from './api.js';

export type ChatNavThread = {
  id: string;
  title: string;
  updatedAt?: string;
};

interface ChatHistoryNavProps {
  workspaceRoot?: string;
  threads: ChatNavThread[];
  activeThreadId?: string;
  busy?: boolean;
  loading?: boolean;
  onOpenThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onNewChat: () => void;
  onSwitchWorkspace: () => void;
}

export function ChatHistoryNav(props: ChatHistoryNavProps) {
  const label = props.workspaceRoot
    ? workspaceLabel(props.workspaceRoot)
    : 'No workspace';

  if (props.loading && props.threads.length === 0 && !props.workspaceRoot) {
    return (
      <nav className="side-list side-list--grouped" aria-label="Chats" aria-busy>
        <div className="side-nav-loading">
          <span className="side-nav-spinner" aria-hidden />
          <span>Loading chats…</span>
        </div>
      </nav>
    );
  }

  return (
    <nav className="side-list side-list--grouped" aria-label="Chats">
      <div className="side-project-head">
        <div className="side-project-head__meta" title={props.workspaceRoot}>
          <span className="side-nav-label">Project</span>
          <strong className="side-project-head__title">{label}</strong>
        </div>
        <div className="side-project-head__actions">
          <button
            type="button"
            className="side-project-head__btn"
            disabled={props.busy}
            title="Switch workspace"
            aria-label="Switch workspace"
            onClick={props.onSwitchWorkspace}
          >
            <IconSwitch size={15} />
            <span>Switch</span>
          </button>
          <button
            type="button"
            className="side-project-head__btn side-project-head__btn--primary"
            disabled={props.busy || props.loading || !props.workspaceRoot}
            title="New chat"
            aria-label="New chat"
            onClick={props.onNewChat}
          >
            <IconPlus size={15} />
            <span>New</span>
          </button>
        </div>
      </div>

      {props.loading ? (
        <div className="side-nav-loading side-nav-loading--inline" aria-busy>
          <span className="side-nav-spinner" aria-hidden />
          <span>Updating…</span>
        </div>
      ) : null}

      {!props.workspaceRoot ? (
        <p className="side-empty">Open a workspace to start chatting</p>
      ) : props.threads.length === 0 && !props.loading ? (
        <p className="side-empty">No chats yet</p>
      ) : (
        <div className="side-group__threads side-group__threads--flat">
          {props.threads.map((thread) => {
            const selected = thread.id === props.activeThreadId;
            return (
              <div
                key={thread.id}
                className={`side-thread${selected ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="side-thread__open"
                  disabled={props.busy || props.loading}
                  onClick={() => props.onOpenThread(thread.id)}
                >
                  <span className="side-thread__dot" aria-hidden />
                  <span className="side-thread__title">
                    {thread.title || 'Chat'}
                  </span>
                </button>
                <button
                  type="button"
                  className="side-thread__delete"
                  disabled={props.busy || props.loading}
                  aria-label={`Delete ${thread.title || 'chat'}`}
                  title="Delete chat"
                  onClick={() => props.onDeleteThread(thread.id)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}
