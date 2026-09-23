/**
 * Collapsible chat sidebar grouped by workspace / project.
 */

import { workspaceLabel } from './api.js';

export type ChatNavThread = {
  id: string;
  title: string;
  updatedAt?: string;
};

export type ChatNavGroup = {
  workspaceRoot: string;
  threads: ChatNavThread[];
  active: boolean;
};

interface ChatHistoryNavProps {
  groups: ChatNavGroup[];
  activeThreadId?: string;
  collapsed: Record<string, boolean>;
  busy?: boolean;
  loading?: boolean;
  onToggleGroup: (workspaceRoot: string) => void;
  onOpenThread: (workspaceRoot: string, threadId: string) => void;
  onDeleteThread: (workspaceRoot: string, threadId: string) => void;
  onNewChat: (workspaceRoot: string) => void;
}

function isGroupCollapsed(
  collapsed: Record<string, boolean>,
  root: string,
  active: boolean,
): boolean {
  if (Object.prototype.hasOwnProperty.call(collapsed, root)) {
    return Boolean(collapsed[root]);
  }
  return !active;
}

function projectInitial(label: string): string {
  const clean = label.trim();
  if (!clean) return '?';
  return clean[0]!.toUpperCase();
}

export function ChatHistoryNav(props: ChatHistoryNavProps) {
  if (props.loading && props.groups.length === 0) {
    return (
      <nav className="side-list side-list--grouped" aria-label="Chats" aria-busy>
        <div className="side-nav-loading">
          <span className="side-nav-spinner" aria-hidden />
          <span>Loading chats…</span>
        </div>
      </nav>
    );
  }

  if (props.groups.length === 0) {
    return (
      <nav className="side-list" aria-label="Chats">
        <p className="side-empty">No projects yet</p>
      </nav>
    );
  }

  return (
    <nav className="side-list side-list--grouped" aria-label="Chats by project">
      <div className="side-nav-label">Projects</div>
      {props.loading ? (
        <div className="side-nav-loading side-nav-loading--inline" aria-busy>
          <span className="side-nav-spinner" aria-hidden />
          <span>Updating…</span>
        </div>
      ) : null}
      {props.groups.map((group) => {
        const collapsed = isGroupCollapsed(
          props.collapsed,
          group.workspaceRoot,
          group.active,
        );
        const label = workspaceLabel(group.workspaceRoot);
        return (
          <section
            key={group.workspaceRoot}
            className={`side-group${group.active ? ' is-active' : ''}${collapsed ? ' is-collapsed' : ''}`}
          >
            <div className="side-group__head">
              <button
                type="button"
                className="side-group__toggle"
                aria-expanded={!collapsed}
                title={group.workspaceRoot}
                onClick={() => props.onToggleGroup(group.workspaceRoot)}
              >
                <span className="side-group__chevron" aria-hidden>
                  {collapsed ? '▸' : '▾'}
                </span>
                <span className="side-group__avatar" aria-hidden>
                  {projectInitial(label)}
                </span>
                <span className="side-group__meta">
                  <span className="side-group__title">{label}</span>
                  <span className="side-group__count">
                    {group.threads.length === 1
                      ? '1 chat'
                      : `${group.threads.length} chats`}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="side-group__new"
                disabled={props.busy || props.loading}
                aria-label={`New chat in ${label}`}
                title="New chat"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onNewChat(group.workspaceRoot);
                }}
              >
                +
              </button>
            </div>
            {!collapsed ? (
              <div className="side-group__threads">
                {group.active && props.loading ? (
                  <div className="side-nav-loading side-nav-loading--inline">
                    <span className="side-nav-spinner" aria-hidden />
                    <span>Loading chats…</span>
                  </div>
                ) : group.threads.length === 0 ? (
                  <p className="side-empty">No chats yet</p>
                ) : (
                  group.threads.map((thread) => {
                    const selected =
                      group.active && thread.id === props.activeThreadId;
                    return (
                      <div
                        key={thread.id}
                        className={`side-thread${selected ? ' is-active' : ''}`}
                      >
                        <button
                          type="button"
                          className="side-thread__open"
                          disabled={props.busy || props.loading}
                          onClick={() =>
                            props.onOpenThread(group.workspaceRoot, thread.id)
                          }
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
                          onClick={() =>
                            props.onDeleteThread(
                              group.workspaceRoot,
                              thread.id,
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </nav>
  );
}
