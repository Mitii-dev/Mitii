/**
 * Route JSONL / agent-session log analysis to a narrow, tool-first path.
 * Mirrors auditRouting.ts: deterministic tools first, no subagents / repo RAG.
 */

import { AGENT_NAME } from '../../../shared/brand';

export const LOG_AUDIT_ALLOWED_TOOLS = new Set([
  'read_file',
  'read_files',
  'resolve_path',
  'list_files',
  'search',
  'search_batch',
  'repo_map',
  'retrieve_context',
  'git_diff',
  'diagnostics',
  'memory_search',
  'run_command',
  'execute_workspace_script',
  'search_script_catalog',
  'use_skill',
  'fetch_web',
  'ask_question',
  'project_catalog',
  'analyze_change_impact',
  'propose_file_scope',
  'analyze_log_directory',
  'analyze_jsonl',
  'query_log_events',
]);

/** Mutating, broad fan-out, and plan-management tools are not exposed on this route. */
export const LOG_AUDIT_EXCLUDED_TOOLS = new Set([
  'write_file',
  'apply_patch',
  'memory_write',
  'spawn_research_agent',
  'spawn_subagent',
  'save_task_state',
  'discover_project_catalog',
  'mark_step_complete',
  'propose_plan_mutation',
]);

export const LOG_AUDIT_SKIP_RETRIEVAL_SOURCES = new Set([
  'project-rules',
  'project-catalog',
  'mentioned-files',
  'skill-catalog',
  'fts',
  'indexed-file-search',
  'vector',
  'repo-map',
  'memory',
  'auto-memory',
  'git-diff',
  'workspace-overview',
  'diagnostics',
  'open-files',
  'current-editor',
  'call-graph',
]);

const JSONL_OR_LOG_PATH =
  /\b[\w./-]+\.(?:jsonl|json|log)\b/i;

/** Session log dir hint (relative or absolute, slash optional). */
const SESSION_LOG_DIR =
  /((?:\/[\w.-]+)+\/\.mitii\/logs\/?|(?:^|[\s`"'(])\.mitii\/logs\/?)/i;

/** Both word orders: analyze→log and log→improve. */
function hasLogAnalysisIntent(text: string): boolean {
  return (
    /\b(analy[sz]e|analysis|audit|inspect|review|debug|explain|summarize|investigate|improv(?:e|ed|ements?))\b[\s\S]{0,160}\b(log|logs|jsonl|session|trace|telemetry|agent\s+run|token\s+usage)\b/i.test(
      text
    ) ||
    /\b(log|logs|jsonl|session\s+log)\b[\s\S]{0,160}\b(analy[sz]e|analysis|audit|inspect|review|improv(?:e|ed|ements?))\b/i.test(
      text
    )
  );
}

const SESSION_LOG_HINT =
  /\b(\.mitii\/logs\/?|session\s+log|agent\s+log|tool_start|tool_end|ui_trace|token_usage)\b/i;

const EXPLICIT_JSONL =
  /\b[\w./-]+\.jsonl\b/i;

/** True when the user is asking to analyze a structured JSON/JSONL/session log. */
export function isLogAuditTask(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const pointsAtSessionLogs = SESSION_LOG_DIR.test(trimmed) || SESSION_LOG_HINT.test(trimmed);
  const wantsAnalysis =
    hasLogAnalysisIntent(trimmed) ||
    /\b(what|why|how|where|find|count|token|tool|error|fail|improv)\b/i.test(trimmed);

  // Explicit JSONL path + any analysis-ish framing
  if (EXPLICIT_JSONL.test(trimmed) && wantsAnalysis) {
    return true;
  }

  // `.mitii/logs` directory (common Ask phrasing) without a single .jsonl file
  if (pointsAtSessionLogs && wantsAnalysis) {
    return true;
  }

  if (SESSION_LOG_HINT.test(trimmed) && JSONL_OR_LOG_PATH.test(trimmed)) {
    return true;
  }

  if (hasLogAnalysisIntent(trimmed) && JSONL_OR_LOG_PATH.test(trimmed)) {
    return true;
  }

  return false;
}

export function extractLogAuditTargetPath(text: string): string | undefined {
  const jsonl = text.match(/\b([\w./-]+\.jsonl)\b/i);
  if (jsonl?.[1]) return jsonl[1];
  const absDir = text.match(/((?:\/[\w.-]+)+\/\.mitii\/logs\/?)/i);
  if (absDir?.[1]) return absDir[1].replace(/\/?$/, '/');
  const relDir = text.match(/(?:^|[\s`"'(])(\.mitii\/logs\/?)/i);
  if (relDir?.[1]) return relDir[1].replace(/\/?$/, '/');
  return undefined;
}

export function buildLogAuditBootstrapBlock(targetPath?: string): string {
  const isDir = Boolean(targetPath && /(?:^|\/)\.mitii\/logs\/?$/.test(targetPath));
  const pathHint = targetPath
    ? isDir
      ? `Target log directory (user-explicit): \`${targetPath}\` — call \`analyze_log_directory({ path })\` exactly once.`
      : `Target log (user-explicit — highest priority over pinned context): \`${targetPath}\``
    : 'If no single `.jsonl` path is named, call `analyze_log_directory({ path: ".mitii/logs/" })`.';

  return `## MANDATORY LOG AUDIT BOOTSTRAP

${pathHint}

1. For a directory, call \`analyze_log_directory({ path })\`. For one file, call \`analyze_jsonl({ path })\`.
2. Optionally one \`query_log_events\` follow-up (limit ≤ 30, maxChars ≤ 8000) only when the aggregate report says evidence is insufficient for a specific claim.
3. Synthesize from the evidence packet. Stop — tools are disabled after sufficient analysis.
4. Treat \`inputTokens\` as per-call usage; report cumulative/turn totals separately.
5. Separate confirmed findings from hypotheses. Cite file paths and event line numbers when present.
6. Use the deterministic analyzers first. Read-only inspection tools such as \`list_files\`, \`search\`, \`read_file\`, \`run_command\`, and \`use_skill\` are available only for narrow follow-up context or recovery. Do not use write tools or subagents on this route.

${AGENT_NAME} parses logs in code; the model only interprets the compact report.`;
}

export function buildLogAuditBlockedToolMessage(toolName: string, task: string): string {
  return [
    `LOG AUDIT — tool "${toolName}" is not available on this route.`,
    'Use analyze_log_directory for directories or analyze_jsonl for a single file first. Read-only inspection/use_skill tools are available for narrow follow-up context; mutating and broad fan-out tools are blocked.',
    `Blocked task: ${task.slice(0, 400)}`,
  ].join('\n');
}

export const LOG_AUDIT_AGENT_MAX_STEPS = 3;

export const NO_TOOLS_LOG_AUDIT_NUDGE = `You responded without calling tools. For log analysis you MUST call:

1. analyze_log_directory({ path: "<user-named log directory>" }) for directories, or analyze_jsonl({ path: "<user-named .jsonl>" }) for one file
2. Optionally query_log_events once for a narrow follow-up
3. Then write the final analysis. Use read-only inspection only when the analyzer output is insufficient.

Call the correct analyzer now.`;
