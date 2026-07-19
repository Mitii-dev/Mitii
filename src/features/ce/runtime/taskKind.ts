import { isLogAuditTask, LOG_AUDIT_AGENT_MAX_STEPS, NO_TOOLS_LOG_AUDIT_NUDGE } from './logAudit';

export { isLogAuditTask, LOG_AUDIT_AGENT_MAX_STEPS, NO_TOOLS_LOG_AUDIT_NUDGE };

/** Audit / cleanup / dependency analysis tasks (report-first, scripts-first). */
export function isAuditCleanupTask(text: string): boolean {
  if (isLogAuditTask(text)) return false;
  return /\b(?:un(?:used|sed)\s+(?:dependencies|dependency|deps?|imports?|exports?|files?)|dead\s+code|orphan(?:ed)?\s+(?:files?|exports?)|dependency\s+(?:audit|cleanup)|depcheck|knip|ts-prune|remove\s+(?:all\s+)?(?:the\s+)?un(?:used|sed)\s+(?:imports?|files?|dependencies)|find\s+un(?:used|sed)|list\s+un(?:used|sed)|reduce\s+bundle|tree[- ]shake)\b/i.test(
    text
  );
}

export const AUDIT_AGENT_MAX_STEPS = 30;

export const NO_TOOLS_AUDIT_NUDGE = `You responded without calling any tools. For audit/cleanup tasks you MUST use tools now — scripts first, NOT subagents for dependencies:

1. execute_workspace_script({ script: "audit-dependencies.mjs" }) — checks ALL npm deps via depcheck in one pass (~3s)
2. execute_workspace_script({ script: "audit-dead-code.sh" }) — knip: unused files, deps, exports
3. read_file for package.json only if scripts are unavailable

Do NOT spawn_research_agent to search each dependency. Do NOT run 20+ search queries.
Call execute_workspace_script in this turn.`;
