/**
 * Map Mitii RunEvents → compact activity items for the Desktop timeline.
 * Mirrors VS Code activitySegments for thinking merge + tool replace rules.
 */

import { parsePathsFromToolSummary, WRITE_TOOLS } from './fileChanges.js';

export type DesktopActivityKind =
  | 'info'
  | 'tool'
  | 'context'
  | 'thinking'
  | 'decision'
  | 'warning'
  | 'suspended'
  | 'mcp_app';

export interface DesktopMcpAppPayload {
  serverId: string;
  tool: string;
  title: string;
  checkpointId?: string;
  svgDataUrl?: string;
  html?: string;
  paths: {
    md?: string;
    docsMd?: string;
    excalidraw?: string;
    svg?: string;
  };
}

export interface DesktopActivityItem {
  id: string;
  at: number;
  kind: DesktopActivityKind;
  title: string;
  detail?: string;
  status?: string;
  /** When a thinking segment finished (for “Thought for Xs”). */
  endedAt?: number;
  /** Paths mutated by write tools (apply_patch, etc.). */
  paths?: string[];
  /** Excalidraw / MCP App diagram card. */
  mcpApp?: DesktopMcpAppPayload;
}

const STAGE_LABELS: Record<string, string> = {
  received: 'Received',
  understanding: 'Understanding',
  understood: 'Understanding',
  decision: 'Deciding',
  decided: 'Deciding',
  context_ready: 'Gathering context',
  skills_ready: 'Skills',
  memory_ready: 'Memory',
  plan_ready: 'Planning',
  discovery: 'Discovering',
  prompt_ready: 'Preparing prompt',
  model_loop: 'Thinking...',
  model_running: 'Thinking...',
  tool_running: 'Running tools...',
  verification: 'Verifying...',
  verifying: 'Verifying...',
  completed: 'Completed',
};

const THINKING_PREVIEW_MAX = 12_000;

let activitySeq = 0;

function nextId(): string {
  activitySeq += 1;
  return `act_${Date.now().toString(36)}_${activitySeq}`;
}

function eventAtMs(event: Record<string, unknown>): number {
  if (typeof event.at === 'string') {
    const ms = Date.parse(event.at);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toolMergeKey(title: string): string {
  return title.replace(/^Running\s+/, '');
}

/** Convert a streamed RunEvent into a timeline row (or null to skip). */
export function runEventToActivity(event: unknown): DesktopActivityItem | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as Record<string, unknown>;
  const type = asString(e.type);
  if (!type) return null;
  const id = nextId();
  const at = eventAtMs(e);

  switch (type) {
    case 'stage_started': {
      const stage = asString(e.stage) ?? 'stage';
      return {
        id,
        at,
        kind: 'info',
        title: STAGE_LABELS[stage] ?? stage,
        status: 'running',
      };
    }
    case 'stage_completed': {
      const stage = asString(e.stage) ?? 'stage';
      return {
        id,
        at,
        kind: 'info',
        title: STAGE_LABELS[stage] ?? stage,
        status: 'done',
      };
    }
    case 'state_pinned':
      return {
        id,
        at,
        kind: 'context',
        title: 'Repository state pinned',
      };
    case 'model_delta':
      if (e.kind === 'reasoning') {
        return {
          id,
          at,
          kind: 'thinking',
          title: 'Thinking',
          detail: typeof e.preview === 'string' ? e.preview : undefined,
          status: 'running',
        };
      }
      // content → answer body; tool_call → wait for tool_started
      return null;
    case 'model_turn': {
      const turn = typeof e.turnIndex === 'number' ? e.turnIndex + 1 : '?';
      const inTok = typeof e.inputTokens === 'number' ? e.inputTokens : 0;
      const outTok = typeof e.outputTokens === 'number' ? e.outputTokens : 0;
      return {
        id,
        at,
        kind: e.truncated ? 'warning' : 'info',
        title: e.truncated
          ? `Tokens · turn ${turn} truncated`
          : `Tokens · turn ${turn}`,
        detail: `↑${inTok.toLocaleString()} · ↓${outTok.toLocaleString()}`,
        status: e.truncated ? 'failed' : 'done',
      };
    }
    case 'tool_started': {
      const toolName = asString(e.toolName) ?? 'tool';
      const paths = WRITE_TOOLS.has(toolName)
        ? parsePathsFromToolSummary(asString(e.summary))
        : [];
      return {
        id,
        at,
        kind: 'tool',
        title: `Running ${toolName}`,
        detail: asString(e.summary),
        status: 'running',
        ...(paths.length ? { paths } : {}),
      };
    }
    case 'tool_completed': {
      const toolName = asString(e.toolName) ?? 'tool';
      const paths = WRITE_TOOLS.has(toolName)
        ? parsePathsFromToolSummary(asString(e.summary))
        : [];
      const label =
        toolName === 'apply_patch'
          ? paths.length === 1
            ? `Apply patch · ${paths[0]}`
            : paths.length > 1
              ? `Apply patch · ${paths.length} files`
              : 'Apply patch'
          : toolName;
      return {
        id,
        at,
        kind: 'tool',
        title: label,
        detail: asString(e.summary) ?? asString(e.status),
        status: asString(e.status) ?? 'done',
        ...(paths.length ? { paths } : {}),
      };
    }
    case 'context_ready': {
      const blocks = typeof e.blockCount === 'number' ? e.blockCount : 0;
      const selected =
        typeof e.selectedItems === 'number' ? e.selectedItems : 0;
      return {
        id,
        at,
        kind: 'context',
        title: 'Context ready',
        detail: `${selected} selected · ${blocks} blocks`,
        status: 'done',
      };
    }
    case 'decision_made':
      return {
        id,
        at,
        kind: 'decision',
        title: `Route · ${asString(e.route) ?? 'unknown'}`,
        detail: asString(e.approvalMode)
          ? `approval=${e.approvalMode}`
          : undefined,
        status: 'done',
      };
    case 'skills_ready':
      return {
        id,
        at,
        kind: 'info',
        title: 'Skills ready',
        detail:
          typeof e.selectedCount === 'number'
            ? `${e.selectedCount} selected`
            : undefined,
        status: 'done',
      };
    case 'prompt_ready':
      return {
        id,
        at,
        kind: 'info',
        title: 'Prompt ready',
        status: 'done',
      };
    case 'task_list_updated': {
      const done = typeof e.completedCount === 'number' ? e.completedCount : 0;
      const total = typeof e.totalCount === 'number' ? e.totalCount : 0;
      return {
        id,
        at,
        kind: 'info',
        title: 'Tasks',
        detail: `${done}/${total} complete`,
      };
    }
    case 'suspended':
      return {
        id,
        at,
        kind: 'suspended',
        title: `Paused · ${asString(e.kind) ?? 'suspended'}`,
        detail: asString(e.rationale),
        status: 'failed',
      };
    case 'warning':
      return {
        id,
        at,
        kind: 'warning',
        title: 'Warning',
        detail: asString(e.message),
        status: 'failed',
      };
    case 'mcp_app': {
      const mcpApp = e.mcpApp;
      if (!mcpApp || typeof mcpApp !== 'object') return null;
      const app = mcpApp as Record<string, unknown>;
      const title = asString(app.title) ?? 'Diagram';
      const pathsRaw =
        app.paths && typeof app.paths === 'object'
          ? (app.paths as Record<string, unknown>)
          : {};
      return {
        id,
        at,
        kind: 'mcp_app',
        title,
        detail: asString(e.detail),
        status: 'succeeded',
        mcpApp: {
          serverId: asString(app.serverId) ?? 'excalidraw',
          tool: asString(app.tool) ?? 'create_view',
          title,
          ...(asString(app.checkpointId)
            ? { checkpointId: asString(app.checkpointId) }
            : {}),
          ...(asString(app.svgDataUrl)
            ? { svgDataUrl: asString(app.svgDataUrl) }
            : {}),
          ...(asString(app.html) ? { html: asString(app.html) } : {}),
          paths: {
            ...(asString(pathsRaw.md) ? { md: asString(pathsRaw.md) } : {}),
            ...(asString(pathsRaw.docsMd)
              ? { docsMd: asString(pathsRaw.docsMd) }
              : {}),
            ...(asString(pathsRaw.excalidraw)
              ? { excalidraw: asString(pathsRaw.excalidraw) }
              : {}),
            ...(asString(pathsRaw.svg) ? { svg: asString(pathsRaw.svg) } : {}),
          },
        },
      };
    }
    case 'terminal':
      return {
        id,
        at,
        kind: asString(e.status) === 'completed' ? 'info' : 'warning',
        title: `Finished · ${asString(e.status) ?? 'done'}`,
        status: asString(e.status) === 'completed' ? 'done' : 'failed',
      };
    default:
      return null;
  }
}

/** Merge consecutive thinking deltas; complete running tools in place. */
export function appendActivity(
  list: DesktopActivityItem[],
  incoming: DesktopActivityItem,
): DesktopActivityItem[] {
  const last = list[list.length - 1];

  if (incoming.kind === 'thinking' && last?.kind === 'thinking') {
    const detail = `${last.detail ?? ''}${incoming.detail ?? ''}`.slice(
      -THINKING_PREVIEW_MAX,
    );
    const next = [...list];
    next[next.length - 1] = {
      ...last,
      detail,
      status: incoming.status ?? last.status,
      at: last.at,
    };
    return next;
  }

  if (incoming.kind === 'thinking') {
    return [...list, incoming].slice(-80);
  }

  let working = list;
  // Close any open brainstorming segment before tools / other activity.
  if (last?.kind === 'thinking' && last.status === 'running') {
    working = [...list];
    working[working.length - 1] = {
      ...last,
      status: 'done',
      endedAt: incoming.at,
    };
  }

  // Complete prior running tool when a completed tool with same name arrives
  if (
    incoming.kind === 'tool' &&
    incoming.status &&
    incoming.status !== 'running'
  ) {
    for (let i = working.length - 1; i >= 0; i -= 1) {
      const row = working[i]!;
      if (row.kind !== 'tool' || row.status !== 'running') continue;
      if (toolMergeKey(row.title) !== toolMergeKey(incoming.title)) continue;
      const next = [...working];
      next[i] = {
        ...row,
        title: incoming.title,
        detail: incoming.detail ?? row.detail,
        status: incoming.status,
        paths: incoming.paths ?? row.paths,
        at: row.at,
      };
      return next;
    }
  }

  const lastWorking = working[working.length - 1];
  if (
    lastWorking &&
    lastWorking.kind === incoming.kind &&
    lastWorking.title === incoming.title &&
    incoming.kind === 'tool' &&
    lastWorking.status === 'running'
  ) {
    const next = [...working];
    next[next.length - 1] = {
      ...lastWorking,
      detail: incoming.detail ?? lastWorking.detail,
      status: incoming.status ?? lastWorking.status,
      at: incoming.at,
    };
    return next;
  }

  return [...working, incoming].slice(-80);
}
