/** Route dependency audits away from slow LLM search loops toward deterministic scripts. */

import { AGENT_NAME } from '../../shared/brand';

export const DEPENDENCY_AUDIT_SCRIPTS = [
  {
    name: 'audit-dependencies.mjs',
    purpose: 'depcheck — unused production + dev dependencies across package roots (~1s)',
  },
  {
    name: 'audit-dead-code.sh',
    purpose: 'knip — unused files, dependencies, devDependencies, exports (~2s)',
  },
] as const;

export const VULNERABILITY_AUDIT_SCRIPTS = [
  {
    name: 'audit-vulnerabilities.mjs',
    purpose: 'pnpm/npm/yarn audit + OSV enrichment — CVE/advisory scan (read-only, ~few seconds)',
  },
] as const;

const DEPENDENCY_ENUMERATION =
  /\b(unused|dead|orphan|unreferenced|remove|purge|clean)\s+(npm\s+)?(production\s+|dev\s+)?dependenc/i;

const PER_PACKAGE_SEARCH =
  /\b(check|verify|audit|scan|search|find uses of|grep for)\b.{0,60}\b(each|every|all|individual|per[- ]package|one by one)\b/i;

const DEPENDENCY_LIST_IN_TASK =
  /\b(\d+\s+(production|dev)\s+dependenc|dependenc(y|ies)\s+list|list of dependenc)/i;

const AUDIT_CLEANUP_TASK =
  /\b(unus[a-z]*|dead code|orphan|cleanup|clean up|remove\s+(?:all\s+)?(?:the\s+)?(?:(?:uns[a-z]*|unused)\s+)?(?:imports?|files?|dependenc(?:y|ies)?|export)|depcheck|dependencies audit|dependency audit|find unused|list unused|reduce bundle|tree[- ]shake)\b/i;

const VULNERABILITY_TASK =
  /\b(vulnerabilit\w*|cve\b|advisories\b|advisory\b|security\s+audit|npm\s+audit|pnpm\s+audit|yarn\s+audit|outdated\s+packages?|package\s+updates?|known\s+issues?|osv\b|ghsa\b)/i;

/** True when the user wants CVE / security advisory scanning rather than unused-deps cleanup. */
export function isVulnerabilityAuditTask(text: string): boolean {
  if (!VULNERABILITY_TASK.test(text)) return false;
  // Prefer vulnerability routing when security terms dominate; unused-dep wording can coexist.
  if (DEPENDENCY_ENUMERATION.test(text) && !/\b(vulnerabilit\w*|cve\b|advisory\b|security\s+audit)/i.test(text)) {
    return false;
  }
  return true;
}

/** True when a subagent would likely run dozens of sequential search loops. */
export function isDependencyEnumerationTask(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\b(execute_workspace_script|search_script_catalog|audit-dependencies|audit-dead-code|audit-vulnerabilities)\b/.test(lower)) {
    return false;
  }
  if (isVulnerabilityAuditTask(text)) return true;
  if (DEPENDENCY_ENUMERATION.test(text)) return true;
  if (AUDIT_CLEANUP_TASK.test(text)) return true;
  if (PER_PACKAGE_SEARCH.test(text) && /\bdependenc|npm package|package\.json\b/i.test(text)) return true;
  if (DEPENDENCY_LIST_IN_TASK.test(text)) return true;
  if (/\bAudit unused\b/i.test(text)) return true;
  if (/\b(unused|dead|orphan)\b.{0,50}\b(import|export|file|asset|source|dependenc)/i.test(text)) return true;

  const scopedPackages = text.match(/@[\w.-]+\/[\w.-]+/g) ?? [];
  if (scopedPackages.length >= 8) return true;

  const quotedPackages = text.match(/["'`][@a-z0-9/_-]+["'`]/gi) ?? [];
  if (quotedPackages.length >= 12) return true;

  return false;
}

/** Block research subagents for any audit/cleanup delegation (not just dependency lists). */
export function isAuditSubagentBlocked(text: string): boolean {
  return isDependencyEnumerationTask(text);
}

export function buildScriptFirstAuditMessage(task: string): string {
  if (isVulnerabilityAuditTask(task)) {
    const scripts = VULNERABILITY_AUDIT_SCRIPTS.map((s) => `- **${s.name}** — ${s.purpose}`).join('\n');
    return [
      'VULNERABILITY AUDIT — use the dedicated script (not unused-deps depcheck).',
      '',
      `Run in your NEXT tool call (scripts live in ${AGENT_NAME} extension; execute_workspace_script resolves them automatically):`,
      scripts,
      '',
      'Preferred:',
      '1. `execute_workspace_script({ script: "audit-vulnerabilities.mjs" })`',
      '2. Optionally `run_command({ command: "pnpm audit --json" })` or `npm audit --json` (read-only in Ask/Plan)',
      '3. For a specific advisory URL or package page: `fetch_web({ url })`',
      '',
      'Do NOT use audit-dependencies.mjs for CVE scans (that script is unused-deps only).',
      'Do NOT spawn_research_agent. Do NOT search_batch per dependency.',
      '',
      `Blocked task: ${task.slice(0, 400)}`,
    ].join('\n');
  }

  const scripts = DEPENDENCY_AUDIT_SCRIPTS.map((s) => `- **${s.name}** — ${s.purpose}`).join('\n');
  return [
    'AUDIT SUBAGENT BLOCKED — would take 60–380s via sequential LLM search loops with no findings.',
    '',
    `Run these in your NEXT tool call (scripts live in ${AGENT_NAME} extension; execute_workspace_script resolves them automatically):`,
    scripts,
    '',
    'Preferred:',
    '1. `execute_workspace_script({ script: "audit-dependencies.mjs" })`',
    '2. `execute_workspace_script({ script: "audit-dead-code.sh" })`',
    '',
    'Fallback if scripts fail:',
    '3. `run_command({ command: "npx depcheck --json" })`',
    '4. `run_command({ command: "npx knip --reporter json" })`',
    '',
    'Do NOT spawn_research_agent. Do NOT search_batch per dependency or per file.',
    '',
    `Blocked task: ${task.slice(0, 400)}`,
  ].join('\n');
}

/** Injected at session start for audit/cleanup tasks in Agent mode. */
export function buildAuditBootstrapBlock(): string {
  return `## MANDATORY AUDIT BOOTSTRAP (first tool round)

Choose the correct script family BEFORE list_files / search / spawn_research_agent:

**CVE / vulnerability / outdated packages:**
1. execute_workspace_script({ script: "audit-vulnerabilities.mjs" })
2. Optional: run_command pnpm/npm audit|outdated, or fetch_web for advisory URLs

**Unused dependencies / dead code cleanup:**
1. execute_workspace_script({ script: "audit-dependencies.mjs" })
2. execute_workspace_script({ script: "audit-dead-code.sh" })

${AGENT_NAME} runs bundled scripts from the extension when the workspace has no scripts/ folder.
Subagents are DISABLED for audit tasks — they caused 108s+ black holes with "(no findings)".

After script output: report findings with confidence (high/medium/low). Only then proceed to edits.`;
}

export function estimateSubagentAuditSeconds(dependencyCount = 64, searchesPerDep = 0.3): number {
  const inferencePerRoundSec = 3;
  const searchRounds = Math.ceil(dependencyCount * searchesPerDep);
  const contextSlowdown = 1 + Math.log2(Math.max(searchRounds, 1)) * 0.15;
  return Math.round(searchRounds * inferencePerRoundSec * contextSlowdown);
}

export function estimateScriptAuditSeconds(): number {
  return 3;
}
