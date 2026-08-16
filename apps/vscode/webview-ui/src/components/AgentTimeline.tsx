import type { ActivityEventPayload } from '../protocol';

interface AgentTimelineProps {
  events: ActivityEventPayload[];
  streaming?: boolean;
  /** When this group of steps ended (e.g. the timestamp text resumed at), used to time the final thinking step. */
  endAt?: number;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

function thinkingLabel(
  item: ActivityEventPayload,
  index: number,
  events: ActivityEventPayload[],
  streaming: boolean,
  groupEndAt?: number,
): string {
  const isLast = index === events.length - 1;
  if (streaming && isLast) return 'Thinking…';
  const next = events[index + 1];
  const endAt = next ? next.at : (groupEndAt ?? item.at);
  return `Thought for ${formatDuration(endAt - item.at)}`;
}

function thinkingPreview(detail: string | undefined): string {
  return (detail ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-4)
    .join('\n');
}

function markerVariant(item: ActivityEventPayload): string {
  if (item.kind === 'thinking' || item.kind === 'context' || item.kind === 'info') {
    return 'muted';
  }
  if (item.kind === 'warning' || item.kind === 'suspended') return 'warn';
  if (item.status === 'running') return 'active';
  if (item.status === 'failed') return 'warn';
  return 'done';
}

function isActionKind(kind: ActivityEventPayload['kind']): boolean {
  return kind === 'tool' || kind === 'decision' || kind === 'warning' || kind === 'suspended';
}

function rawToolName(title: string): string {
  return title.replace(/^Running\s+/, '').trim();
}

function isCommandEvent(item: ActivityEventPayload): boolean {
  if (item.kind !== 'tool') return false;
  return /^(run_)?(?:readonly_)?command$|^run_readonly_command$|^exec_command$|^shell_command$/i.test(
    rawToolName(item.title),
  );
}

function commandText(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const argv = /^argv=(["']?)(.*)\1(?:\s+\([^)]+\))?$/s.exec(detail.trim());
  return (argv?.[2] ?? detail).trim();
}

function formatToolTitle(item: ActivityEventPayload): string {
  if (isCommandEvent(item)) {
    return item.status === 'running' ? 'Running command' : 'Command';
  }
  if (item.kind !== 'tool') return item.title;

  const title = rawToolName(item.title);
  const explicit: Record<string, string> = {
    apply_patch: 'Apply patch',
    delete_directory: 'Delete directory',
    delete_file: 'Delete file',
    fetch_docs: 'Fetch docs',
    fetch_url: 'Fetch URL',
    file_metadata: 'File metadata',
    find_references: 'Find references',
    glob_files: 'Find files',
    goto_definition: 'Go to definition',
    list_directory: 'List directory',
    read_diagnostics: 'Read diagnostics',
    read_file: 'Read file',
    read_git_status: 'Read Git status',
    read_many_files: 'Read files',
    read_package_scripts: 'Read package scripts',
    search_files: 'Search files',
    update_todos: 'Update plan',
    web_search: 'Web search',
  };
  if (explicit[title]) return explicit[title];
  const spaced = title.replace(/_/g, ' ');
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : item.title;
}

export function AgentTimeline({
  events,
  streaming = false,
  endAt,
}: AgentTimelineProps) {
  if (events.length === 0) return null;

  return (
    <ol className="timeline" aria-label="Agent activity">
      {events.map((item, index) => {
        const isActiveThinking =
          streaming && index === events.length - 1 && item.kind === 'thinking';
        const preview = isActiveThinking ? thinkingPreview(item.detail) : '';
        return (
          <li
            key={item.id}
            className={`timeline__row timeline__row--${markerVariant(item)}${
              item.kind === 'tool' ? ' timeline__row--tool' : ''
            }${isActiveThinking ? ' timeline__row--thinking-active' : ''}${
              isCommandEvent(item) ? ' timeline__row--command' : ''
            }`}
          >
            <span className="timeline__marker" aria-hidden="true" />
            {item.kind === 'thinking' ? (
              <span className="timeline__row-text timeline__row-text--muted">
                <span className="timeline__thinking-label">
                  {isActiveThinking
                    ? 'Brainstorming'
                    : thinkingLabel(item, index, events, streaming, endAt)}
                </span>
                {preview ? (
                  <pre className="timeline__thinking-preview">{preview}</pre>
                ) : null}
              </span>
            ) : (
              <span className="timeline__row-text">
                <strong
                  className={`timeline__row-title${
                    isActionKind(item.kind) ? '' : ' timeline__row-title--plain'
                  }`}
                >
                  {formatToolTitle(item)}
                </strong>
                {isCommandEvent(item) && commandText(item.detail) ? (
                  <span className="timeline__command" role="text">
                    <span className="timeline__command-prompt" aria-hidden="true">
                      $
                    </span>
                    <code>{commandText(item.detail)}</code>
                  </span>
                ) : item.detail ? (
                  <>
                    {' '}
                    <code className="timeline__row-detail">{item.detail}</code>
                  </>
                ) : null}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
