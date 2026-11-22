import type {
  AgentMode,
  MitiiAutonomyPreset,
  UserRequestOrigin,
} from '@mitii/sdk';
import type { ParsedCliArgs } from './types.js';

/** Intermediate argv scan state consumed by {@link resolveCliArgs}. */
export interface CliArgScanState {
  flags: Set<string>;
  positionals: string[];
  cwd?: string;
  autoClarify?: string;
  autoApproval?: 'approved' | 'denied';
  exportPath?: string;
  mode?: AgentMode | 'database';
  origin?: UserRequestOrigin;
  autonomyPreset?: MitiiAutonomyPreset;
  agent?: string;
  profile?: string;
  promptFlag?: string;
  promptFile?: string;
  recipe?: string;
  skills: string[];
  images: string[];
  setupProvider?: string;
  setupModel?: string;
  setupBaseUrl?: string;
  loopPolicyJson?: string;
  timeoutSeconds?: number;
  /** Once `connect` is seen, remaining argv (flags included) is channel passthrough. */
  connectPassthrough?: string[];
  /** Once a passthrough subcommand is seen, remaining argv is passthrough. */
  automationPassthrough?: string[];
}

export type CliArgScanOutcome =
  | { kind: 'early'; result: ParsedCliArgs }
  | { kind: 'scanned'; state: CliArgScanState };
