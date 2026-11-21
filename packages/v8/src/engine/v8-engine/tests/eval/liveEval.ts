import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Helpers for the optional live curated-40 eval.
 *
 * The live path drives an already-built Mitii CLI as a subprocess, so this
 * package never imports hosts or the SDK. Everything here is pure or
 * filesystem-local and is unit-tested without any model/API access.
 */

export const LIVE_EVAL_ENV = "MITII_LIVE_EVAL";
export const DEFAULT_LIVE_EVAL_TIMEOUT_SECONDS = 300;

export interface CuratedPrompt {
  id: number;
  bucket: string;
  prompt: string;
  expectedRoute: string;
  passBar: {
    mutationRequired?: boolean;
    acceptContinueWithoutMutation: boolean;
  };
}

export interface CuratedCatalogShape {
  count: number;
  prompts: CuratedPrompt[];
}

export function isLiveEvalEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[LIVE_EVAL_ENV] === "1";
}

/**
 * Narrow the catalog for a live run.
 * - `MITII_LIVE_EVAL_IDS`: comma-separated prompt ids
 * - `MITII_LIVE_EVAL_BUCKET`: single bucket name
 * - `MITII_LIVE_EVAL_LIMIT`: max prompts after filtering (default: all)
 */
export function selectLivePrompts(
  catalog: CuratedCatalogShape,
  env: NodeJS.ProcessEnv,
): CuratedPrompt[] {
  let prompts = [...catalog.prompts];
  const ids = (env.MITII_LIVE_EVAL_IDS ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(Number)
    .filter((value) => Number.isInteger(value));
  if (ids.length > 0) {
    const wanted = new Set(ids);
    prompts = prompts.filter((prompt) => wanted.has(prompt.id));
  }
  const bucket = env.MITII_LIVE_EVAL_BUCKET?.trim();
  if (bucket) {
    prompts = prompts.filter((prompt) => prompt.bucket === bucket);
  }
  const limit = Number(env.MITII_LIVE_EVAL_LIMIT);
  if (Number.isInteger(limit) && limit > 0) {
    prompts = prompts.slice(0, limit);
  }
  return prompts;
}

export function resolveLiveTimeoutSeconds(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.MITII_LIVE_EVAL_TIMEOUT_SECONDS);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_LIVE_EVAL_TIMEOUT_SECONDS;
}

/** CLI argv (after the entry script) for one unattended prompt. */
export function buildLiveCliArgs(params: {
  prompt: string;
  cwd: string;
  timeoutSeconds: number;
}): string[] {
  return [
    "run",
    "--auto",
    params.prompt,
    "--cwd",
    params.cwd,
    "--timeout",
    String(params.timeoutSeconds),
  ];
}

export interface LiveRunOutcome {
  /** CLI exit code (0 completed, 4 clarification, anything else failed). */
  exitCode: number | null;
  /** True when the workspace differs from the pre-run snapshot. */
  workspaceChanged: boolean;
}

export interface LiveGrade {
  pass: boolean;
  reason: string;
}

/**
 * Grade one live run against the catalog pass bar. A run that merely
 * suspends or exits cleanly without mutating never passes a
 * mutation-required prompt (no Continue-only green).
 */
export function gradeLiveRun(
  prompt: CuratedPrompt,
  outcome: LiveRunOutcome,
): LiveGrade {
  const mutationRequired = prompt.passBar.mutationRequired === true;
  if (outcome.exitCode === null) {
    return { pass: false, reason: "timed out or killed" };
  }
  if (mutationRequired) {
    if (outcome.exitCode !== 0) {
      return { pass: false, reason: `exit ${outcome.exitCode}, mutation required` };
    }
    return outcome.workspaceChanged
      ? { pass: true, reason: "completed with workspace mutation" }
      : { pass: false, reason: "completed without mutation (continue-only)" };
  }
  if (outcome.exitCode === 0 || outcome.exitCode === 4) {
    return { pass: true, reason: "answered or asked for clarification" };
  }
  return { pass: false, reason: `exit ${outcome.exitCode}` };
}

const SNAPSHOT_SKIP_DIRS = new Set([".git", "node_modules", ".mitii"]);

/** Content-hash snapshot of a workspace (relative path → sha1). */
export function snapshotWorkspace(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SNAPSHOT_SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const info = statSync(full);
      if (info.isDirectory()) {
        walk(full);
      } else if (info.isFile()) {
        snapshot.set(
          relative(root, full),
          createHash("sha1").update(readFileSync(full)).digest("hex"),
        );
      }
    }
  };
  walk(root);
  return snapshot;
}

export function snapshotsDiffer(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): boolean {
  if (before.size !== after.size) return true;
  for (const [path, hash] of after) {
    if (before.get(path) !== hash) return true;
  }
  return false;
}
