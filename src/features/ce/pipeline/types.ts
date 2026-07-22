/**
 * Shared types for the turn pipeline.
 * See ./README.md for the stage order and folder map.
 */

export type AuditSubtype =
  | 'unused_deps'
  | 'dead_code'
  | 'vulnerability'
  | 'log'
  | 'prompt'
  | 'security_config'
  | 'git_history'
  | 'ci'
  | 'database'
  | 'architecture'
  | 'code_quality'
  | 'generic'
  /** Bare "audit" mention with no cleanup language — a review, not a depcheck/knip cleanup. */
  | 'review';

export type DocsSubtype =
  | 'readme'
  | 'api_reference'
  | 'architecture'
  | 'docusaurus'
  | 'mdx_repair'
  | 'changelog'
  | 'examples'
  | 'generic';

export type OperationClass =
  | 'inspect'
  | 'workspace_write'
  | 'local_git_write'
  | 'remote_write'
  | 'release'
  | 'log_analyze'
  | 'execute_saved_plan';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ArtifactKind =
  | 'project'
  | 'package'
  | 'directory'
  | 'source_file'
  | 'readme'
  | 'documentation'
  | 'jsonl_file'
  | 'log_directory'
  | 'configuration'
  | 'test'
  | 'git_repository'
  | 'unknown';

export interface ArtifactSignal {
  kind: ArtifactKind;
  path?: string;
  /** Catalog project id when kind is `project`. */
  projectId?: string;
  source: 'explicit' | 'conversation' | 'inferred';
  confidence: number;
}

/** Optional catalog entries used to resolve `@project` mentions. */
export interface KnownProjectRef {
  id: string;
  root: string;
  name?: string;
}

export interface ArtifactClassification {
  artifacts: ArtifactSignal[];
}

/** User-facing / product planning axis. */
export type PlanningDepthAxis = 'direct' | 'quick' | 'deep';

/** Internal step-budget enum kept for PlanExecutor compatibility. */
export type InternalPlanningDepth = 'none' | 'micro' | 'short' | 'standard' | 'full';

export type PipelineIntent =
  | 'bugfix'
  | 'feature'
  | 'refactor'
  | 'docs'
  | 'audit'
  | 'log_audit'
  | 'question'
  | 'diagnose'
  | 'git'
  | 'greeting'
  | 'spike';

export interface TaskClassification {
  primaryKind: string;
  confidence: number;
  signals: string[];
  needsClarification: boolean;
}

export interface RouteResolution {
  intent: PipelineIntent;
  auditSubtype?: AuditSubtype;
  docsSubtype?: DocsSubtype;
  risk: RiskLevel;
  /** Short factors behind `risk`, for prompt explainability — not a stable/parsed contract. */
  riskReasons?: string[];
  operationClass: OperationClass;
  executionPath:
    | 'direct'
    | 'orchestrated'
    | 'audit'
    | 'log_audit'
    | 'mdx_repair'
    | 'resume_saved_plan';
  isGitTask: boolean;
  summary: string;
}

export interface SkillResolution {
  /** At most one full playbook injected into context. */
  activeSkill?: string;
  /** Optional secondary guidance contribution; never grants capabilities. */
  supportingSkill?: string;
  /** Names the model may load via use_skill (catalog / deferred). */
  deferredSkills: string[];
  /** Ordered list for telemetry: active first, then deferred. */
  suggestedSkills: string[];
  /** Skills to inject: zero/one primary plus at most one supporting contribution. */
  injectSkills: string[];
  /** Explainable engine report for telemetry and internal analysis. */
  engineReport?: {
    engineVersion: string;
    candidates: Array<{ id: string; score: number; status: string; reasons: string[] }>;
    rejected: Array<{ id: string; status: string; reasons: string[] }>;
  };
}

export type McpPolicy =
  | 'full'
  | 'no_filesystem'
  | 'none';

export interface CapabilityResolution {
  /** Exact tool names allowed this turn (when set, filter to this set + mode allowlist intersection). */
  allowedTools?: Set<string>;
  /** Tool names always excluded. */
  excludedTools: Set<string>;
  mcpPolicy: McpPolicy;
  /** Prefer builtin read/write over MCP filesystem duplicates. */
  preferBuiltinFilesystem: boolean;
  maxProposeFileScopePerStep: number;
  approvalProfile: 'default' | 'git' | 'release' | 'read_only';
}

export interface PipelineResolution {
  classification: TaskClassification;
  artifact: ArtifactClassification;
  route: RouteResolution;
  depthAxis: PlanningDepthAxis;
  internalDepth: InternalPlanningDepth;
  skills: SkillResolution;
  capabilities: CapabilityResolution;
  shouldUsePlanner: boolean;
}
