import type { ActivityEventPayload } from '../protocol';

interface AgentTimelineProps {
  events: ActivityEventPayload[];
  streaming?: boolean;
  /** When this group of steps ended (e.g. the timestamp text resumed at), used to time the final thinking step. */
  endAt?: number;
}

interface FileListDetail {
  paths: string[];
  more?: number;
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

function looksLikePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 260) return false;
  if (/\s{2,}/.test(trimmed)) return false;
  if (/^(block|retrieved|selected|dropped|status)=/i.test(trimmed)) return false;
  return (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    /\.[A-Za-z0-9]{1,12}$/.test(trimmed) ||
    trimmed.startsWith('@') ||
    trimmed === '.gitignore' ||
    trimmed.startsWith('.')
  );
}

function parseMoreSuffix(value: string): { text: string; more?: number } {
  const match = /(?:^|\s)(?:·\s*)?\+(\d+)\s+more\s*$/i.exec(value);
  if (!match) return { text: value.trim() };
  return {
    text: value.slice(0, match.index).trim().replace(/[·,]\s*$/, '').trim(),
    more: Number(match[1]),
  };
}

function parseFileListDetail(
  item: ActivityEventPayload,
): FileListDetail | undefined {
  const detail = item.detail?.trim();
  if (!detail) return undefined;

  const pathEq = /^path=(.+)$/s.exec(detail);
  if (pathEq?.[1]) {
    const path = pathEq[1].replace(/\s+startLine=\d+.*$/, '').trim();
    return path ? { paths: [path] } : undefined;
  }

  const pathsEq = /^paths=(.+)$/s.exec(detail);
  if (pathsEq?.[1]) {
    const raw = pathsEq[1].trim();
    const plus = /\+(\d+)$/.exec(raw);
    const body = plus ? raw.slice(0, plus.index).replace(/,\s*$/, '') : raw;
    const paths = body
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (!paths.length) return undefined;
    return {
      paths,
      more: plus ? Number(plus[1]) : undefined,
    };
  }

  const isFileContext =
    item.kind === 'context' ||
    /^Read(\s+\d+)?\s+files?/i.test(item.title) ||
    /^Read\s+@/i.test(item.title);

  if (!isFileContext) return undefined;

  if (detail.includes('\n')) {
    const lines = detail
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const moreLine = lines.find((line) => /^\+\d+\s+more$/i.test(line));
    const paths = lines.filter((line) => !/^\+\d+\s+more$/i.test(line));
    if (!paths.length || !paths.every(looksLikePath)) return undefined;
    return {
      paths,
      more: moreLine ? Number(/^\+(\d+)/.exec(moreLine)?.[1]) : undefined,
    };
  }

  const { text, more } = parseMoreSuffix(detail);
  const paths = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (paths.length < 1 || !paths.every(looksLikePath)) return undefined;
  return { paths, more };
}

function FileListBox({ paths, more }: FileListDetail) {
  return (
    <div className="timeline__files" role="group" aria-label="Files">
      {paths.map((path, index) => (
        <div key={`${path}-${index}`} className="timeline__files-row">
          <span className="timeline__files-prompt" aria-hidden="true">
            {index === 0 ? '$' : ' '}
          </span>
          <code className="timeline__files-path">{path.replace(/^@/, '')}</code>
        </div>
      ))}
      {more && more > 0 ? (
        <div className="timeline__files-row">
          <span className="timeline__files-prompt" aria-hidden="true">
            {' '}
          </span>
          <span className="timeline__files-more">+{more} more</span>
        </div>
      ) : null}
    </div>
  );
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
        const files = !isCommandEvent(item) ? parseFileListDetail(item) : undefined;
        return (
          <li
            key={item.id}
            className={`timeline__row timeline__row--${markerVariant(item)}${
              item.kind === 'tool' ? ' timeline__row--tool' : ''
            }${isActiveThinking ? ' timeline__row--thinking-active' : ''}${
              isCommandEvent(item) ? ' timeline__row--command' : ''
            }${files ? ' timeline__row--files' : ''}`}
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
                ) : files ? (
                  <FileListBox paths={files.paths} more={files.more} />
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
