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

const RUNNING_HINT = 'Agent is running — wait for the current reply';

export function ChatHistoryNav(props: ChatHistoryNavProps) {
  const label = props.workspaceRoot
    ? workspaceLabel(props.workspaceRoot)
    : 'No workspace';
  const locked = Boolean(props.busy);

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
    <nav
      className={`side-list side-list--grouped${locked ? ' side-list--busy' : ''}`}
      aria-label="Chats"
      aria-busy={locked || undefined}
    >
      <div className="side-project-head">
        <div className="side-project-head__meta" title={props.workspaceRoot}>
          <span className="side-nav-label">Project</span>
          <strong className="side-project-head__title">{label}</strong>
        </div>
        <div className="side-project-head__actions">
          <button
            type="button"
            className={`side-project-head__btn${locked ? ' is-locked' : ''}`}
            aria-disabled={locked || undefined}
            title={locked ? RUNNING_HINT : 'Switch workspace'}
            aria-label={locked ? RUNNING_HINT : 'Switch workspace'}
            onClick={() => {
              if (locked) return;
              props.onSwitchWorkspace();
            }}
          >
            <IconSwitch size={15} />
            <span>Switch</span>
          </button>
          <button
            type="button"
            className={`side-project-head__btn side-project-head__btn--primary${
              locked || props.loading || !props.workspaceRoot ? ' is-locked' : ''
            }`}
            aria-disabled={
              locked || props.loading || !props.workspaceRoot || undefined
            }
            title={
              locked
                ? RUNNING_HINT
                : !props.workspaceRoot
                  ? 'Open a workspace first'
                  : 'New chat'
            }
            aria-label={locked ? RUNNING_HINT : 'New chat'}
            onClick={() => {
              if (locked || props.loading || !props.workspaceRoot) return;
              props.onNewChat();
            }}
          >
            <IconPlus size={15} />
            <span>New</span>
          </button>
        </div>
      </div>

      {locked ? (
        <div className="side-busy-banner" role="status">
          <span className="side-nav-spinner" aria-hidden />
          <span>Running…</span>
        </div>
      ) : null}

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
            const otherLocked = locked && !selected;
            return (
              <div
                key={thread.id}
                className={`side-thread${selected ? ' is-active' : ''}${
                  otherLocked ? ' is-locked' : ''
                }${selected && locked ? ' is-running' : ''}`}
                title={otherLocked ? RUNNING_HINT : undefined}
              >
                <button
                  type="button"
                  className={`side-thread__open${otherLocked ? ' is-locked' : ''}`}
                  aria-disabled={otherLocked || props.loading || undefined}
                  aria-current={selected ? 'true' : undefined}
                  title={otherLocked ? RUNNING_HINT : thread.title || 'Chat'}
                  onClick={() => {
                    if (otherLocked || props.loading) return;
                    if (selected) return;
                    props.onOpenThread(thread.id);
                  }}
                >
                  {selected && locked ? (
                    <span
                      className="side-thread__spinner"
                      aria-label="Running"
                    />
                  ) : (
                    <span className="side-thread__dot" aria-hidden />
                  )}
                  <span className="side-thread__title">
                    {thread.title || 'Chat'}
                  </span>
                </button>
                <button
                  type="button"
                  className={`side-thread__delete${locked ? ' is-locked' : ''}`}
                  aria-disabled={locked || props.loading || undefined}
                  aria-label={
                    locked
                      ? RUNNING_HINT
                      : `Delete ${thread.title || 'chat'}`
                  }
                  title={locked ? RUNNING_HINT : 'Delete chat'}
                  onClick={() => {
                    if (locked || props.loading) return;
                    props.onDeleteThread(thread.id);
                  }}
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
