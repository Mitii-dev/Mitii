/**
 * Chat sidebar — simple reference layout: actions, workspace chats, profile.
 */

import {
  IconChat,
  IconClose,
  IconFolder,
  IconHistory,
  IconNewFolder,
  IconSettings,
  IconSkills,
  IconUser,
} from '../shell/ActivityIcons.js';
import { workspaceLabel } from '../api.js';
import { formatThreadAge } from './threadAge.js';

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
  profileName?: string;
  onOpenThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onNewChat: () => void;
  onOpenWorkspace: () => void;
  onOpenSkills: () => void;
  onOpenSettings: () => void;
  onOpenProfile?: () => void;
}

const RUNNING_HINT = 'Agent is running — wait for the current reply';

function isMacPlatform(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
  );
}

export function ChatHistoryNav(props: ChatHistoryNavProps) {
  const label = props.workspaceRoot
    ? workspaceLabel(props.workspaceRoot)
    : 'No workspace';
  const locked = Boolean(props.busy);
  const newDisabled = locked || props.loading || !props.workspaceRoot;
  const shortcut = isMacPlatform() ? '⌘N' : 'Ctrl+N';
  const profileName = props.profileName?.trim() || 'Mitii';

  return (
    <nav
      className={`side-nav${locked ? ' side-nav--busy' : ''}`}
      aria-label="Chats"
      aria-busy={locked || undefined}
    >
      <div className="side-actions">
        <button
          type="button"
          className={`side-action${newDisabled ? ' is-locked' : ''}`}
          aria-disabled={newDisabled || undefined}
          title={
            locked
              ? RUNNING_HINT
              : !props.workspaceRoot
                ? 'Open a workspace first'
                : 'New chat'
          }
          onClick={() => {
            if (newDisabled) return;
            props.onNewChat();
          }}
        >
          <IconChat size={16} />
          <span className="side-action__label">New chat</span>
          <kbd className="side-action__kbd">{shortcut}</kbd>
        </button>
        <button
          type="button"
          className="side-action"
          title="Open workspace"
          onClick={() => props.onOpenWorkspace()}
        >
          <IconNewFolder size={16} />
          <span className="side-action__label">Open workspace</span>
        </button>
        <button
          type="button"
          className="side-action"
          title="Skills"
          onClick={() => props.onOpenSkills()}
        >
          <IconSkills size={16} />
          <span className="side-action__label">Skills</span>
        </button>
      </div>

      <div className="side-section">
        <div className="side-section__head">
          <span className="side-section__title">Chats</span>
          <span className="side-section__icon" aria-hidden title="History">
            <IconHistory size={12} />
          </span>
        </div>

        {locked ? (
          <div className="side-busy-banner" role="status">
            <span className="side-nav-spinner" aria-hidden />
            <span>Running…</span>
          </div>
        ) : null}

        {props.loading ? (
          <div className="side-nav-loading" aria-busy>
            <span className="side-nav-spinner" aria-hidden />
            <span>Updating…</span>
          </div>
        ) : null}

        {!props.workspaceRoot ? (
          <p className="side-empty">Open a workspace to start</p>
        ) : (
          <div className="side-project">
            <div className="side-project__name" title={props.workspaceRoot}>
              <IconFolder size={14} />
              <span>{label}</span>
            </div>

            {props.threads.length === 0 && !props.loading ? (
              <p className="side-empty side-empty--inset">No chats yet</p>
            ) : (
              <div className="side-threads">
                {props.threads.map((thread) => {
                  const selected = thread.id === props.activeThreadId;
                  const otherLocked = locked && !selected;
                  const age = formatThreadAge(thread.updatedAt);
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
                        className={`side-thread__open${
                          otherLocked ? ' is-locked' : ''
                        }`}
                        aria-disabled={otherLocked || props.loading || undefined}
                        aria-current={selected ? 'true' : undefined}
                        title={
                          otherLocked ? RUNNING_HINT : thread.title || 'Chat'
                        }
                        onClick={() => {
                          if (otherLocked || props.loading) return;
                          if (selected) return;
                          props.onOpenThread(thread.id);
                        }}
                      >
                        {selected ? (
                          selected && locked ? (
                            <span
                              className="side-thread__spinner"
                              aria-label="Running"
                            />
                          ) : (
                            <span className="side-thread__dot" aria-hidden />
                          )
                        ) : (
                          <span className="side-thread__spacer" aria-hidden />
                        )}
                        <span className="side-thread__title">
                          {thread.title || 'Chat'}
                        </span>
                        {age ? (
                          <span className="side-thread__age">{age}</span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className={`side-thread__delete${
                          locked ? ' is-locked' : ''
                        }`}
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
                        <IconClose size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="side-profile">
        <button
          type="button"
          className="side-profile__user"
          title="Switch profile"
          onClick={() => props.onOpenProfile?.()}
        >
          <span className="side-profile__avatar" aria-hidden>
            <IconUser size={14} />
          </span>
          <span className="side-profile__name">{profileName}</span>
        </button>
        <button
          type="button"
          className="side-profile__settings"
          title="Settings"
          aria-label="Settings"
          onClick={() => props.onOpenSettings()}
        >
          <IconSettings size={15} />
        </button>
      </div>
    </nav>
  );
}
