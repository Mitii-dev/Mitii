import type { TaskConstraintKind, TaskRisk } from "./contracts";

/**
 * TASK CONSTRAINT PATTERNS
 */

export const CONSTRAINT_PATTERNS = [
  {
    kind: "prohibition",
    pattern: /\b(?:do not|don't|dont|never)\b[^.!?;\n]{1,180}/gi,
    confidence: 0.95,
  },
  {
    kind: "restriction",
    pattern:
      /\b(?:only|without|avoid)\b[^.!?;\n]{1,180}|\bno\s+(?:code|file)?\s*(?:changes?|edits?|modifications?|files?|tests?)\b[^.!?;\n]{0,120}/gi,
    confidence: 0.85,
  },
  {
    kind: "requirement",
    pattern:
      /\b(?:must|has to|have to|required to|make sure|ensure that)\b[^.!?;\n]{1,180}/gi,
    confidence: 0.9,
  },
  {
    kind: "preservation",
    pattern:
      /\b(?:keep|preserve|maintain|retain|do not break|don't break|remain compatible)\b[^.!?;\n]{1,180}/gi,
    confidence: 0.9,
  },
  {
    kind: "technology",
    pattern:
      /\b(?:use|using|with)\s+(?:typescript|javascript|python|java|go|rust|react|vue|angular|svelte|next\.?js|express|fastify|prisma|drizzle|tailwind|docker|terraform|kubernetes)\b[^.!?;\n]{0,120}/gi,
    confidence: 0.8,
  },
] as const satisfies readonly {
  kind: TaskConstraintKind;
  pattern: RegExp;
  confidence: number;
}[];

export const SCOPE_CONSTRAINT_PATTERNS = [
  {
    kind: "scope",
    pattern:
      /\b(?:only modify|only change|only edit|limit changes to|restrict changes to)\b[^.!?;\n]{1,180}/gi,
    confidence: 0.97,
  },
  {
    kind: "scope",
    pattern:
      /\b(?:single file|one file|this file only|selected file only|do not touch other files|don't touch other files)\b[^.!?;\n]{0,100}/gi,
    confidence: 0.95,
  },
  {
    kind: "scope",
    pattern:
      /\bin\s+[\w./@${}-][\w./@${}-]*\s+only\b[^.!?;\n]{0,80}/gi,
    confidence: 0.96,
  },
  {
    kind: "prohibition",
    pattern:
      /\b(?:do not|don't|dont)\s+(?:modify|change|edit|touch|alter)\b[^.!?;\n]{1,160}/gi,
    confidence: 0.97,
  },
] as const satisfies readonly {
  kind: TaskConstraintKind;
  pattern: RegExp;
  confidence: number;
}[];

export const VERIFICATION_CONSTRAINT_PATTERNS = [
  {
    kind: "verification",
    pattern:
      /\b(?:all tests must pass|keep tests passing|do not break tests|don't break tests|run the tests|verify the build|build must pass|lint must pass|no lint errors)\b[^.!?;\n]{0,120}/gi,
    confidence: 0.95,
  },
  {
    kind: "verification",
    pattern:
      /\b(?:without adding tests|do not add tests|don't add tests|skip tests|do not run tests|don't run tests)\b[^.!?;\n]{0,120}/gi,
    confidence: 0.93,
  },
] as const satisfies readonly {
  kind: TaskConstraintKind;
  pattern: RegExp;
  confidence: number;
}[];

/**
 * TASK RISK PATTERNS
 */

export const RISK_PATTERNS = [
  {
    pattern: /\brm\s+-rf\b|\bformat\s+(?:disk|drive)\b/i,
    score: 7,
    risk: "critical",
    evidence: "A destructive filesystem command was detected.",
    requiresAct: true,
  },
  {
    pattern: /\b(?:drop|truncate)\s+(?:table|database|schema)\b/i,
    score: 7,
    risk: "critical",
    evidence: "A destructive database operation was detected.",
    requiresAct: true,
  },
  {
    pattern: /\bdelete\s+from\b(?![^;\n]*\bwhere\b)/i,
    score: 7,
    risk: "critical",
    evidence: "A potentially unbounded database deletion was detected.",
    requiresAct: true,
  },
  {
    pattern:
      /\b(?:deploy|release|publish|push)\b[^.!?;\n]{0,80}\bproduction\b|\bproduction\b[^.!?;\n]{0,80}\b(?:deploy|release|publish|push)\b/i,
    score: 6,
    risk: "critical",
    evidence: "A production deployment or release action was detected.",
    requiresAct: true,
  },
  {
    pattern:
      /\b(?:rotate|replace|delete|remove|revoke|expose|print|log)\b[^.!?;\n]{0,80}\b(?:credentials?|api keys?|private keys?|secrets?|tokens?)\b/i,
    score: 6,
    risk: "critical",
    evidence: "A credential mutation or exposure operation was detected.",
    requiresAct: true,
  },
  {
    pattern:
      /\b(?:payment|billing|stripe|checkout|invoice|refund|subscription)\b/i,
    score: 4,
    risk: "high",
    evidence: "Payment or billing functionality was detected.",
    requiresAct: true,
  },
  {
    pattern:
      /\b(?:authentication|authorization|oauth|sso|jwt|passwords?|permissions?|access control)\b/i,
    score: 4,
    risk: "high",
    evidence: "Authentication or authorization functionality was detected.",
    requiresAct: true,
  },
  {
    pattern:
      /\b(?:cve|vulnerabilit(?:y|ies)|sql injection|xss|csrf|command injection|remote code execution|privilege escalation)\b/i,
    score: 5,
    risk: "high",
    evidence: "An explicit security vulnerability was detected.",
  },
  {
    pattern:
      /\b(?:database migration|schema migration|data migration|backfill|alter table|drop column|rename column)\b/i,
    score: 4,
    risk: "high",
    evidence: "A database or data migration was detected.",
    requiresAct: true,
  },
  {
    pattern:
      /\b(?:terraform apply|kubectl apply|helm upgrade|cloudformation deploy)\b/i,
    score: 5,
    risk: "high",
    evidence: "An infrastructure mutation command was detected.",
    requiresAct: true,
  },
  {
    pattern:
      /\b(?:public api|breaking change|backward compatibility|api contract)\b/i,
    score: 3,
    risk: "medium",
    evidence: "A public API or compatibility boundary was detected.",
  },
  {
    pattern:
      /\b(?:dependency upgrade|major version|package upgrade|lockfile|peer dependency)\b/i,
    score: 2,
    risk: "medium",
    evidence: "A dependency compatibility change was detected.",
  },
  {
    pattern:
      /\b(?:ci\/cd|pipeline|dockerfile|kubernetes|terraform|deployment configuration)\b/i,
    score: 2,
    risk: "medium",
    evidence:
      "Build, deployment, or infrastructure configuration was detected.",
  },
] as const satisfies readonly {
  pattern: RegExp;
  score: number;
  risk: TaskRisk;
  evidence: string;
  requiresAct?: boolean;
}[];

export const SAFE_CONSTRAINT_PATTERN =
  /\b(?:do not deploy|don't deploy|dont deploy|dry run|read-only|read only|do not apply|don't apply|do not execute|don't execute|without changing|no changes|plan only|explain only)\b/i;
