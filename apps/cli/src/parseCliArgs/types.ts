import type {
  AgentMode,
  MitiiAutonomyPreset,
  UserRequestOrigin,
} from '@mitii/sdk';

export interface ParsedCliArgs {
  command:
    | 'help'
    | 'version'
    | 'ask'
    | 'plan'
    | 'agent'
    | 'run'
    | 'index'
    | 'status'
    | 'export-session'
    | 'session'
    | 'setup'
    | 'connect'
    | 'schedule'
    | 'serve'
    | 'events'
    | 'restore'
    | 'recipe'
    | 'memory'
    | 'commit-message'
    | 'pr-summary'
    | 'changelog'
    | 'review'
    | 'paths'
    | 'doctor'
    | 'profile'
    | 'mcp'
    | 'history'
    | 'unknown'
    | 'error';
  prompt?: string;
  cwd?: string;
  json?: boolean;
  /** NDJSON RunEvent stream + final result line (ask/run). */
  streamJson?: boolean;
  forceEcho?: boolean;
  autoClarify?: string;
  autoApproval?: 'approved' | 'denied';
  /** Unattended CI: `mitii run --auto`. */
  auto?: boolean;
  exportPath?: string;
  mode?: AgentMode | 'database';
  origin?: UserRequestOrigin;
  autonomyPreset?: MitiiAutonomyPreset;
  /** One-off mode profile slug (`.mitii/modes.json` / builtins). */
  profile?: string;
  /** Path or id for `.mitii/agents/<id>.md`. */
  agent?: string;
  /** Explicitly attach skill ids for this run (repeatable). */
  skills?: string[];
  /**
   * Writing recipe id (`commit-message` | `pr-summary` | `changelog`).
   * Force-attaches the matching bundled skill and builds a git-context prompt.
   */
  recipe?: string;
  /** Path to an image file to attach (repeatable, e.g. a screenshot/mockup). */
  images?: string[];
  /** Prompt file path, or `-` for stdin. */
  promptFile?: string;
  /** `mitii review` flags */
  reviewPreview?: boolean;
  reviewFrom?: string;
  reviewTo?: string;
  reviewCommit?: string;
  reviewFormat?: 'json' | 'sarif';
  reviewOutput?: string;
  reviewEffort?: 'low' | 'medium' | 'high';
  unknownCommand?: string;
  errorMessage?: string;
  setupProvider?: string;
  setupModel?: string;
  setupBaseUrl?: string;
  setupGlobal?: boolean;
  setupShow?: boolean;
  setupTest?: boolean;
  setupYes?: boolean;
  /** Host wall-time budget for the run (seconds); engine finalizes near the deadline. */
  timeoutSeconds?: number;
  /** One-off loop-policy threshold JSON (lab). Implies overrides for this run. */
  loopPolicyJson?: string;
  /** Force window-band standards even if config enables loopPolicy. */
  noLoopPolicy?: boolean;
  /** `mitii index --status` — report pipeline health without reindexing. */
  indexStatus?: boolean;
  /** Passthrough args after `connect` (channel + channel flags). */
  rest: string[];
}
