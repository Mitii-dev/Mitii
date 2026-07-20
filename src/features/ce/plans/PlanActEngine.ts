import { normalizeThunderMode } from '../../../features/ce/session/ThunderSession';

export type ThunderPlan = {
  goal: string;
  assumptions: string[];
  phases?: Array<{
    id: string;
    title: string;
    phase: PlanPhase;
    objective?: string;
    steps: Array<{
      id: string;
      title: string;
      objective?: string;
      tools?: string[];
      tool?: string;
      args?: Record<string, unknown>;
      script?: { command?: string; args?: unknown[] };
      dependsOn?: string[];
      successCriteria?: string[];
      files?: string[];
      risk: 'low' | 'medium' | 'high';
    }>;
  }>;
  steps: Array<{
    id: string;
    title: string;
    status: 'pending' | 'running' | 'done' | 'blocked' | 'failed' | 'blocked_by_dependency';
    phase?: PlanPhase;
    objective?: string;
    tools?: string[];
    tool?: string;
    args?: Record<string, unknown>;
    script?: { command?: string; args?: unknown[] };
    dependsOn?: string[];
    successCriteria?: string[];
    files?: string[];
    risk: 'low' | 'medium' | 'high';
  }>;
  requiredApprovals: string[];
};

export type PlanPhase = 'diagnostics' | 'review' | 'execute' | 'verify';

export type AutonomyPreset = 'safe' | 'guided' | 'builder' | 'pilot' | 'enterprise';

export type CommandEffect =
  | 'inspect_only'
  | 'verification_with_artifacts'
  | 'workspace_mutation'
  | 'dependency_mutation'
  | 'external_side_effect'
  | 'unknown';

let configuredVerifyPatterns: string[] = [];

export function setVerifyCommandPatterns(patterns: string[]): void {
  configuredVerifyPatterns = patterns.filter((p) => p.trim().length > 0);
}

export function getVerifyCommandPatterns(): string[] {
  return [...configuredVerifyPatterns];
}

export function parsePlanFromText(text: string): ThunderPlan | null {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[1]) as ThunderPlan;
    if (parsed.goal && Array.isArray(parsed.phases)) {
      parsed.steps = parsed.phases.flatMap((phase, phaseIndex) =>
        (phase.steps ?? []).map((step, stepIndex) => ({
          id: step.id ?? `step-${phaseIndex + 1}-${stepIndex + 1}`,
          title: step.title,
          status: 'pending' as const,
          phase: phase.phase,
          objective: step.objective ?? phase.objective,
          tool: step.tool,
          args: step.args,
          script: step.script,
          dependsOn: step.dependsOn,
          tools: step.tools,
          successCriteria: step.successCriteria,
          files: step.files,
          risk: step.risk ?? 'medium',
        }))
      );
    }
    if (parsed.goal && Array.isArray(parsed.steps)) {
      parsed.assumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions : [];
      parsed.requiredApprovals = Array.isArray(parsed.requiredApprovals) ? parsed.requiredApprovals : [];
      return normalizePlanSafety(normalizePlanStepPhases(parsed));
    }
  } catch {
    return null;
  }
  return null;
}

export function normalizePlanStepPhases(plan: ThunderPlan, mode = 'agent'): ThunderPlan {
  plan.steps = plan.steps.map((step, index) => ({
    ...step,
    status: step.status ?? 'pending',
    phase: normalizeDeclaredStepPhase(step, index, mode),
  }));
  return plan;
}

export function normalizeDeclaredStepPhase(
  step: {
    title: string;
    objective?: string;
    phase?: PlanPhase;
    tools?: string[];
    files?: string[];
  },
  index: number,
  mode = 'agent'
): PlanPhase {
  const declared = coercePlanPhase(step.phase);
  const inferred = inferStepPhase(`${step.title} ${step.objective ?? ''}`, index);
  const declaredLooksWrong =
    inferred === 'diagnostics' &&
    (declared === 'execute' || declared === 'verify') &&
    !stepImpliesWrite(step);
  const phase = declared && !declaredLooksWrong ? declared : inferred;
  return resolveStepPhaseLock({ ...step, phase }, mode) ?? phase;
}

export function normalizePlanSafety(plan: ThunderPlan): ThunderPlan {
  const requiredApprovals = new Set(
    (Array.isArray(plan.requiredApprovals) ? plan.requiredApprovals : [])
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  );

  plan.steps = plan.steps.map((step) => {
    const safety = assessPlanStepSafety(step);
    for (const approval of safety.requiredApprovals) requiredApprovals.add(approval);
    return {
      ...step,
      risk: maxRisk(normalizeRisk(step.risk), safety.minimumRisk),
    };
  });
  plan.requiredApprovals = [...requiredApprovals];
  return plan;
}

export function assessPlanStepSafety(step: {
  title: string;
  objective?: string;
  tool?: string;
  tools?: string[];
  script?: { command?: string };
  files?: string[];
  risk?: 'low' | 'medium' | 'high';
}): { minimumRisk: 'low' | 'medium' | 'high'; requiredApprovals: string[] } {
  const text = `${step.title} ${step.objective ?? ''} ${step.tools?.join(' ') ?? ''} ${step.tool ?? ''}`.toLowerCase();
  const command = step.script?.command ?? '';
  const approvals: string[] = [];
  let minimumRisk: 'low' | 'medium' | 'high' = 'low';

  if (stepImpliesWrite(step) || command) {
    minimumRisk = maxRisk(minimumRisk, 'medium');
  }

  const commandEffect = command ? classifyCommandEffect(command) : 'inspect_only';
  if (commandEffect === 'workspace_mutation' || commandEffect === 'dependency_mutation' || commandEffect === 'external_side_effect') {
    minimumRisk = maxRisk(minimumRisk, 'medium');
  }

  if (isRecursiveDeleteIntent(text, command)) {
    minimumRisk = 'high';
    approvals.push(formatPlanApproval('recursive_delete', step.files));
  } else if (isMultiDeleteIntent(text, command)) {
    minimumRisk = 'high';
    approvals.push(formatPlanApproval('delete_multiple_files', step.files));
  } else if (isGitWorkspaceRestoreCommand(command)) {
    minimumRisk = maxRisk(minimumRisk, 'medium');
  }

  return { minimumRisk, requiredApprovals: approvals };
}

export function isWriteAllowed(mode: string): boolean {
  return normalizeThunderMode(mode) === 'agent';
}

/** Shell commands that only inspect the repo (allowed in plan/review for audits). */
export function isReadOnlyCommand(command: string, extraPatterns: string[] = []): boolean {
  const effect = classifyCommandEffect(command, extraPatterns);
  return effect === 'inspect_only' || effect === 'verification_with_artifacts';
}

export function classifyCommandEffect(command: string, extraPatterns: string[] = []): CommandEffect {
  const cmd = stripLeadingCd(command).trim();
  if (!cmd) return 'unknown';
  const patterns = [...extraPatterns, ...configuredVerifyPatterns];
  const segments = splitShellSegments(cmd).map((part) => part.trim()).filter(Boolean);
  if (segments.length === 0) return 'unknown';

  let strongest: CommandEffect = 'inspect_only';
  for (const segment of segments) {
    const effect = classifyCommandSegmentEffect(segment, patterns);
    if (effectRank(effect) > effectRank(strongest)) strongest = effect;
    if (strongest === 'external_side_effect' || strongest === 'dependency_mutation') return strongest;
  }
  return strongest;
}

function classifyCommandSegmentEffect(cmd: string, extraPatterns: string[] = []): CommandEffect {
  if (isDependencyMutationCommand(cmd)) return 'dependency_mutation';
  if (isObviousWorkspaceMutationCommand(cmd)) return 'workspace_mutation';

  for (const pattern of extraPatterns) {
    if (matchesVerifyPattern(cmd, pattern)) return 'verification_with_artifacts';
  }
  // Shell loop scaffolding — body segments are validated independently after `;` splits.
  if (/^(for|while|do|done|then|else|elif|fi|in)\b/i.test(cmd.trim())) return 'inspect_only';
  if (/^(npx\s+(--yes\s+)?)?depcheck\b/i.test(cmd)) return 'inspect_only';
  if (/^(npx\s+(--yes\s+)?)?knip\b/i.test(cmd)) return 'inspect_only';
  if (/^npx\s+(--yes\s+)?docusaurus\b/i.test(cmd)) return 'verification_with_artifacts';
  if (/^npx\s+eslint\b/i.test(cmd) && !/\s--fix\b/.test(cmd)) return 'verification_with_artifacts';
  if (/^(?:(?:npx\s+(?:--yes\s+)?)|(?:pnpm\s+exec\s+))?tsc\s+[\s\S]*--noEmit\b/i.test(cmd)) return 'inspect_only';
  if (/^(npx\s+(--yes\s+)?)?vitest\s+(run\b|--run\b)/i.test(cmd)) return 'verification_with_artifacts';
  if (/^(npx\s+(--yes\s+)?)?jest\b/i.test(cmd)) return 'verification_with_artifacts';
  // Align npm/pnpm/yarn: audit + outdated are read-only advisory lookups (no lockfile mutation).
  // Also tolerate workspace-scoping flags (pnpm --filter/-F, npm --workspace/-w, yarn workspace)
  // between the binary and the subcommand — otherwise monorepo-scoped invocations like
  // `pnpm --filter <pkg> audit` get misclassified as mutating and force an approval prompt.
  if (/^npm\s+(?:(?:--workspace|-w)=?\s*\S+\s+)?(?:ls|list|outdated|audit|why|view|info)\b/i.test(cmd)) return 'inspect_only';
  if (/^npm\s+(?:(?:--workspace|-w)=?\s*\S+\s+)?run\s+(lint|test|typecheck|check|build|compile|verify|validate|doctor)\b/i.test(cmd)) return 'verification_with_artifacts';
  if (/^yarn\s+(?:workspace\s+\S+\s+)?(?:why|list|info|outdated|audit)\b/i.test(cmd)) return 'inspect_only';
  if (/^yarn\s+(?:workspace\s+\S+\s+)?(?:run\s+)?(?:lint|test|build|compile|typecheck|check|verify|validate|doctor)\b/i.test(cmd)) return 'verification_with_artifacts';
  if (/^pnpm\s+(?:(?:--filter|-F)\s+\S+\s+)?(?:-r\s+|--recursive\s+)?(?:why|list|ls|outdated|audit)\b/i.test(cmd)) return 'inspect_only';
  if (/^pnpm\s+(?:(?:--filter|-F)\s+\S+\s+)?(?:-r\s+|--recursive\s+)?(?:run\s+)?(?:lint|test|build|compile|typecheck|check|verify|validate|doctor)\b/i.test(cmd)) return 'verification_with_artifacts';
  if (/^(?:\.\/mvnw|mvn)\s+test\b/i.test(cmd)) return 'verification_with_artifacts';
  if (/^(?:\.\/gradlew|gradle)\s+test\b/i.test(cmd)) return 'verification_with_artifacts';
  if (/^cargo\s+test\b/i.test(cmd)) return 'verification_with_artifacts';
  if (/^go\s+test\b/i.test(cmd)) return 'verification_with_artifacts';
  if (/^(?:python(?:3)?\s+-m\s+pytest|pytest)\b/i.test(cmd)) return 'verification_with_artifacts';
  if (/^(grep|rg|find|cat|head|tail|sed|wc|sort|uniq|ls|tree|which|echo|awk|jq)\b/i.test(cmd)) return 'inspect_only';
  if (/^git\s+(status|diff|log|ls-files)\b/i.test(cmd)) return 'inspect_only';
  if (/^\d+>&\d+$/.test(cmd.trim())) return 'inspect_only';
  if (/^true$|^false$/.test(cmd.trim())) return 'inspect_only';
  if (/^node\s+(--check|-c)\b/i.test(cmd)) return 'inspect_only';
  if (/^(bash|sh)\s+-n\b/i.test(cmd)) return 'inspect_only';
  // Read-only interpreters for log/JSON inspection pipelines (cat file | python3 -c '...').
  if (isReadOnlyInterpreterSnippet(cmd)) return 'inspect_only';
  return 'unknown';
}

function effectRank(effect: CommandEffect): number {
  switch (effect) {
    case 'inspect_only':
      return 0;
    case 'verification_with_artifacts':
      return 1;
    case 'workspace_mutation':
      return 2;
    case 'dependency_mutation':
      return 3;
    case 'external_side_effect':
      return 4;
    case 'unknown':
      return 5;
  }
}

function isDependencyMutationCommand(cmd: string): boolean {
  return /\b(?:npm|pnpm|yarn)\s+(?:install|add|remove|rm|uninstall|update|dedupe|prune)\b/i.test(cmd) ||
    /\b(?:pip|pip3)\s+install\b/i.test(cmd) ||
    /\b(?:bundle|gem)\s+install\b/i.test(cmd);
}

function isObviousWorkspaceMutationCommand(cmd: string): boolean {
  return /\b(?:rm|mv|cp|mkdir|touch|truncate|chmod|chown)\b/i.test(cmd) ||
    /(?:^|[\s;|&])(?:>|>>)\s*\S+/.test(cmd) ||
    /\bgit\s+(?:checkout\s+--|restore\b|clean\b|reset\b|rm\b)/i.test(cmd) ||
    /\bsed\s+-i\b/i.test(cmd) ||
    /\b(?:eslint|prettier)\b[\s\S]*\s--(?:fix|write)\b/i.test(cmd);
}

/** Allow python/node one-liners that only inspect data — reject obvious mutators. */
function isReadOnlyInterpreterSnippet(cmd: string): boolean {
  const trimmed = cmd.trim();
  const match = trimmed.match(/^(python3?|node)\s+(-c|-e|-p)\s+([\s\S]+)$/i);
  if (!match) return false;
  const snippet = match[3];
  // Strip surrounding quotes for keyword scan.
  const body = snippet.replace(/^['"]|['"]$/g, '');
  if (body.length > 8_000) return false;
  const mutate =
    /\b(writeFile|writeFileSync|appendFile|unlink|rmdir|mkdir|chmod|chown|spawn|exec|open\s*\([^)]*['"]w|open\s*\([^)]*['"]a|os\.remove|shutil|subprocess|requests\.(post|put|patch|delete)|fetch\s*\(|http\.(request|post)|fs\.write|createWriteStream|install|uninstall)\b/i;
  return !mutate.test(body);
}

function matchesVerifyPattern(cmd: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  const c = cmd.trim().toLowerCase();
  if (!p) return false;
  if (c === p) return true;
  if (c.startsWith(`${p} `)) return true;
  // Allow npm run <script> when pattern is npm run <script>
  if (p.startsWith('npm run ') && c.startsWith(p)) return true;
  return false;
}

function normalizeRisk(risk: unknown): 'low' | 'medium' | 'high' {
  if (risk === 'low' || risk === 'medium' || risk === 'high') return risk;
  return 'medium';
}

function maxRisk(
  left: 'low' | 'medium' | 'high',
  right: 'low' | 'medium' | 'high'
): 'low' | 'medium' | 'high' {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[right] > rank[left] ? right : left;
}

function isRecursiveDeleteIntent(text: string, command: string): boolean {
  return /\b(?:rm\s+-[^\n;&|]*r[^\n;&|]*|git\s+clean\s+-[^\n;&|]*f[^\n;&|]*d|recursive(?:ly)?\s+delete|delete\s+.*director|remove\s+.*director)\b/i.test(command) ||
    /\b(?:recursive(?:ly)?\s+delete|delete\s+.*director|remove\s+.*director)\b/i.test(text);
}

function isMultiDeleteIntent(text: string, command: string): boolean {
  return /\b(?:git\s+clean\b|find\b[\s\S]*\s-delete\b|delete\s+multiple|remove\s+multiple|delete\s+\d+\s+files?|remove\s+\d+\s+files?)\b/i.test(command) ||
    /\b(?:delete\s+multiple|remove\s+multiple|delete\s+\d+\s+files?|remove\s+\d+\s+files?)\b/i.test(text);
}

function isGitWorkspaceRestoreCommand(command: string): boolean {
  return /\bgit\s+(?:checkout\s+--|restore\b|clean\b|reset\b|rm\b)/i.test(command);
}

function formatPlanApproval(kind: string, files?: string[]): string {
  const scoped = files?.length ? `:${files.join(',')}` : '';
  return `${kind}${scoped}`;
}

function inferTouchedFilesFromCommandSegment(command: string): string[] {
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) return [];
  if (tokens[0] === 'git' && tokens[1] === 'checkout') {
    const marker = tokens.indexOf('--');
    return marker >= 0 ? cleanPathTokens(tokens.slice(marker + 1)) : [];
  }
  if (tokens[0] === 'git' && tokens[1] === 'restore') {
    const marker = tokens.indexOf('--');
    const candidates = marker >= 0 ? tokens.slice(marker + 1) : tokens.slice(2).filter((token) => !token.startsWith('-'));
    return cleanPathTokens(candidates);
  }
  if (tokens[0] === 'git' && tokens[1] === 'clean') {
    return cleanPathTokens(tokens.slice(2).filter((token) => !token.startsWith('-')));
  }
  if (['rm', 'mv', 'cp'].includes(tokens[0])) {
    return cleanPathTokens(tokens.slice(1).filter((token) => !token.startsWith('-')));
  }
  // `sed -i` / `sed -i ''` in-place edits mutate source files but were previously untracked.
  if (tokens[0] === 'sed' && tokens.some((token) => token === '-i' || token.startsWith('-i'))) {
    const pathTokens = tokens.slice(1).filter((token) => {
      if (token.startsWith('-')) return false;
      // macOS sed -i '' uses an empty extension argument.
      if (token === '') return false;
      // Skip the script expression (usually the first non-flag after -i['' ]).
      return true;
    });
    // Drop the sed script expression (first remaining token).
    return cleanPathTokens(pathTokens.slice(1));
  }
  return [];
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function cleanPathTokens(tokens: string[]): string[] {
  return tokens
    .map((token) => token.trim())
    .filter((token) =>
      token.length > 0 &&
      token !== '.' &&
      !/^(?:2?>&1|true|false)$/.test(token) &&
      !/^[|&;]+$/.test(token)
    );
}

function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    const next = command[i + 1];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }

    if (quote) {
      current += ch;
      if (ch === quote) quote = undefined;
      continue;
    }

    if (ch === '"' || ch === "'") {
      current += ch;
      quote = ch;
      continue;
    }

    if (ch === ';' || (ch === '&' && next === '&') || ch === '|' || (ch === '|' && next === '|')) {
      segments.push(current);
      current = '';
      if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) i += 1;
      continue;
    }

    current += ch;
  }

  segments.push(current);
  return segments;
}

export function stripLeadingCd(command: string): string {
  const match = command.trim().match(/^cd\s+(?:"[^"]+"|'[^']+'|[^\s&;|]+)\s*&&\s*([\s\S]+)$/i);
  return match ? match[1].trim() : command.trim();
}

export function isShellAllowed(mode: string, command?: string): boolean {
  if (normalizeThunderMode(mode) === 'agent') return true;
  if (command && isReadOnlyCommand(command)) return true;
  return false;
}

export function inferTouchedFilesFromCommand(command: string): string[] {
  const files = new Set<string>();
  for (const segment of splitShellSegments(stripLeadingCd(command)).map((part) => part.trim()).filter(Boolean)) {
    for (const file of inferTouchedFilesFromCommandSegment(segment)) files.add(file);
  }
  return [...files];
}

export function isPatchAllowed(mode: string): boolean {
  return normalizeThunderMode(mode) === 'agent';
}

export function inferStepPhase(title: string, index: number): PlanPhase {
  const text = title.toLowerCase();
  const hasFailureCaptureIntent =
    /\b(capture|captured|reproduce|collect|read|inspect|analy[sz]e|identify)\b[\s\S]*\b(fail|failing|failure|error|errors|build|typecheck|compile|test|lint|signal)\b/.test(text);
  if (hasFailureCaptureIntent) return 'diagnostics';

  const hasVerificationIntent =
    /\b(verify|test|lint|validate)\b/.test(text) ||
    /\b(run|rerun|execute|check|ensure)\b[\s\S]*\bbuild\b/.test(text) ||
    /\bbuild\b[\s\S]*\b(pass|passes|succeed|succeeds|verification|output)\b/.test(text);
  if (hasVerificationIntent) return 'verify';
  const hasReadOnlyDiagnosticIntent =
    /\b(capture|reproduce|inspect|analy[sz]e|read|identify|diagnos|investigate|trace|collect|list|search)\b/.test(text);
  const hasStrongWriteIntent =
    /\b(implement|edit|patch|write|remove|delete|update|fix|rewrite|redesign|overhaul|refactor|restore|revert|copy|move|migrate|create|add)\b/.test(text);
  if (hasReadOnlyDiagnosticIntent && !hasStrongWriteIntent) return 'diagnostics';
  if (/\b(execute|implement|edit|patch|write|remove|update|fix|rewrite|redesign|overhaul|refactor|prepare|create|add|build|theme|style|component)\b/.test(text)) {
    return 'execute';
  }
  if (/\b(review|cross-check|confirm|decide)\b/.test(text)) return 'review';
  if (/\b(audit|inspect|analyze|read|identify|diagnostic)\b/.test(text)) return 'diagnostics';
  return index === 0 ? 'diagnostics' : 'execute';
}

const WRITE_INTENT_PATTERN =
  /\b(fix|rewrite|redesign|overhaul|implement|refactor|update|patch|write|prepare|create|add|remove|delete|restore|revert|copy|move|migrate|build|style|theme|component)\b/i;
const READ_ONLY_STEP_PATTERN =
  /\b(capture|reproduce|inspect|analy[sz]e|read|identify|diagnos|investigate|trace|collect|list|search)\b/i;
const STRONG_WRITE_INTENT_PATTERN =
  /\b(fix|rewrite|redesign|overhaul|implement|refactor|update|patch|write|prepare|create|add|remove|delete|restore|revert|copy|move|migrate|style|theme|component)\b/i;

export function stepImpliesWrite(step: {
  title: string;
  objective?: string;
  tools?: string[];
  files?: string[];
}): boolean {
  const text = `${step.title} ${step.objective ?? ''}`;
  const lower = text.toLowerCase();
  if (step.tools?.some((t) => ['write_file', 'apply_patch'].includes(t))) return true;
  if (READ_ONLY_STEP_PATTERN.test(lower) && !STRONG_WRITE_INTENT_PATTERN.test(lower)) {
    return false;
  }
  if (
    /\b(audit|inspect|analyze|diagnostic|identify)\b/.test(lower) &&
    !STRONG_WRITE_INTENT_PATTERN.test(lower)
  ) {
    return false;
  }
  if (WRITE_INTENT_PATTERN.test(text)) return true;
  return false;
}

function coercePlanPhase(phase: unknown): PlanPhase | undefined {
  if (phase === 'diagnostics' || phase === 'review' || phase === 'execute' || phase === 'verify') return phase;
  return undefined;
}

/** Resolve the effective phase lock for a plan step (Agent mode upgrades write steps stuck in diagnostics). */
export function resolveStepPhaseLock(
  step: {
    title: string;
    objective?: string;
    phase?: PlanPhase;
    tools?: string[];
    files?: string[];
  },
  mode: string
): PlanPhase | undefined {
  const declared = step.phase ?? inferStepPhase(step.title, 0);
  if (normalizeThunderMode(mode) !== 'agent') return declared;
  if (
    stepImpliesWrite(step) &&
    (declared === 'diagnostics' || declared === 'review')
  ) {
    return 'execute';
  }
  return declared;
}

export function isPhaseLockWriteError(error?: string): boolean {
  return Boolean(error?.includes('file writes are locked until Phase 3'));
}

export function isPhaseLockRunCommandError(error?: string): boolean {
  if (!error) return false;
  return (
    error.includes('allows only read-only shell commands') ||
    error.includes('Phase 4 (Verify) allows diagnostics, lint, tests, builds') ||
    error.includes('run_command is restricted to read-only commands')
  );
}

export function isToolAllowedInPlanPhase(
  phase: PlanPhase | undefined,
  toolName: string,
  input: Record<string, unknown>
): { allowed: boolean; reason?: string } {
  if (!phase) return { allowed: true };

  if (phase === 'diagnostics' || phase === 'review') {
    if (['write_file', 'apply_patch'].includes(toolName)) {
      return {
        allowed: false,
        reason: `${phaseLabel(phase)} is read-only; file writes are locked until Phase 3 (Execute). If analysis is complete, stop retrying writes — the orchestrator advances steps automatically.`,
      };
    }
    if (toolName === 'run_command' && !isReadOnlyCommand(typeof input.command === 'string' ? input.command : '')) {
      return {
        allowed: false,
        reason: `${phaseLabel(phase)} allows only read-only shell commands.`,
      };
    }
  }

  if (phase === 'verify') {
    if (toolName === 'run_command' && !isReadOnlyCommand(typeof input.command === 'string' ? input.command : '')) {
      return {
        allowed: false,
        reason: 'Phase 4 (Verify) allows diagnostics, lint, tests, builds, and targeted file fixes, not arbitrary shell commands.',
      };
    }
  }

  return { allowed: true };
}

function phaseLabel(phase: PlanPhase): string {
  switch (phase) {
    case 'diagnostics':
      return 'Phase 1 (Diagnostics)';
    case 'review':
      return 'Phase 2 (Review)';
    case 'execute':
      return 'Phase 3 (Execute)';
    case 'verify':
      return 'Phase 4 (Verify)';
  }
}
