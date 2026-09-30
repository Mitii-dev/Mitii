/**
 * Soft heuristic: reject argv that looks like file mutation.
 * Used for run_readonly_command always, and for run_command when
 * softBlockMutatingCommands is set (plan-mode defense). Not a shell
 * interpreter — catches common model mistakes only.
 */
import { CommandPolicyError } from "./CommandPolicy";

/** Leading command words that create/modify/delete files. */
const BLOCKED_COMMANDS = new Set([
  "rm",
  "rmdir",
  "unlink",
  "mv",
  "cp",
  "dd",
  "touch",
  "mkdir",
  "ln",
  "link",
  "chmod",
  "chown",
  "chgrp",
  "truncate",
  "shred",
  "install",
  "patch",
  "rsync",
  "sed",
  "tee",
  "del",
  "erase",
  "move",
  "ren",
  "rename",
  "copy",
  "xcopy",
  "robocopy",
]);

/** Mutating git subcommands (argv form: git <sub>). */
const GIT_MUTATING_SUBCOMMANDS = new Set([
  "add",
  "am",
  "apply",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "switch",
]);

/** Package-manager subcommands that change the workspace tree. */
const PM_MUTATING_SUBCOMMANDS = new Set([
  "add",
  "i",
  "ci",
  "install",
  "remove",
  "rm",
  "uninstall",
  "unlink",
  "link",
  "update",
  "up",
  "upgrade",
  "dedupe",
  "prune",
  "publish",
]);

const SCRIPT_RUNNERS = new Set([
  "node",
  "nodejs",
  "bun",
  "tsx",
  "ts-node",
  "deno",
  "python",
  "python3",
  "ruby",
  "perl",
]);

/**
 * Soft-reject argv that appears to mutate files.
 * Call after grant prefix validation — never widens allow.
 */
export function assertSoftNonMutatingCommand(argv: readonly string[]): void {
  if (argv.length === 0) {
    return;
  }

  const head = basenameCommand(argv[0]!).toLowerCase();
  if (BLOCKED_COMMANDS.has(head)) {
    throwSoft(
      `Refusing mutating command "${argv.join(" ")}" (soft file-edit guard). ` +
        "Use apply_patch / delete_file / move_file for workspace changes.",
    );
  }

  if (looksLikeOutputRedirect(argv)) {
    throwSoft(
      `Refusing command with file redirection (${argv.join(" ")}). ` +
        "Soft file-edit guard blocks shell redirects.",
    );
  }

  if (head === "git") {
    const sub = firstNonFlag(argv.slice(1));
    if (sub && GIT_MUTATING_SUBCOMMANDS.has(sub.toLowerCase())) {
      throwSoft(
        `Refusing mutating git subcommand "git ${sub}". ` +
          "Soft file-edit guard allows read-only git only.",
      );
    }
  }

  if (
    head === "npm" ||
    head === "pnpm" ||
    head === "yarn" ||
    head === "bun"
  ) {
    const sub = firstNonFlag(argv.slice(1));
    if (sub && PM_MUTATING_SUBCOMMANDS.has(sub.toLowerCase())) {
      throwSoft(
        `Refusing mutating package-manager command "${argv.join(" ")}". ` +
          "Soft file-edit guard blocks install/add/remove style mutations.",
      );
    }
  }

  if (looksLikeTempScriptWriteHelper(argv)) {
    throwSoft(
      `Refusing temp/script write helper (${argv.join(" ")}). ` +
        "Use apply_patch for source edits — do not bypass via node/bun/npm exec of a .tmp script.",
    );
  }
}

/**
 * Always-on guard for run_command (write grants): reject temp script helpers
 * even when softBlockMutatingCommands is off.
 */
export function assertNoTempScriptWriteHelper(argv: readonly string[]): void {
  if (looksLikeTempScriptWriteHelper(argv)) {
    throwSoft(
      `Refusing temp/script write helper (${argv.join(" ")}). ` +
        "Use apply_patch for source edits — do not bypass via node/bun/npm exec of a .tmp script.",
    );
  }
}

function throwSoft(message: string): never {
  throw new CommandPolicyError("command_not_allowed", message);
}

function basenameCommand(token: string): string {
  const normalized = token.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function firstNonFlag(parts: readonly string[]): string | undefined {
  for (const part of parts) {
    if (!part.startsWith("-")) {
      return part;
    }
  }
  return undefined;
}

/** Detect argv tokens that act as shell redirects (`>`, `>>`, `1>`). */
function looksLikeOutputRedirect(argv: readonly string[]): boolean {
  return argv.some((part) => /^(?:\d*)>{1,2}$/.test(part) || part === ">>");
}

/**
 * Production bypass: after apply_patch failures, models write `.tmp-fix-*.js`
 * and run it via `node` / `bun` / `npm exec -- node` to mutate source.
 */
function looksLikeTempScriptWriteHelper(argv: readonly string[]): boolean {
  const joined = argv.join(" ");
  if (/\.tmp[-_]?(?:fix|patch|write|edit)/i.test(joined)) {
    return true;
  }
  if (/\.tmp[A-Za-z0-9._-]+\.(?:js|mjs|cjs|ts|py)$/i.test(joined)) {
    return true;
  }

  const head = basenameCommand(argv[0] ?? "").toLowerCase();
  if (SCRIPT_RUNNERS.has(head)) {
    for (const part of argv.slice(1)) {
      if (isTempOrWriteHelperScript(part)) {
        return true;
      }
    }
  }

  if (
    head === "npm" ||
    head === "pnpm" ||
    head === "yarn" ||
    head === "npx" ||
    head === "bun"
  ) {
    const sub = firstNonFlag(argv.slice(1))?.toLowerCase();
    if (sub === "exec" || sub === "dlx" || sub === "x") {
      for (const part of argv.slice(1)) {
        if (isTempOrWriteHelperScript(part)) {
          return true;
        }
      }
    }
  }

  return false;
}

function isTempOrWriteHelperScript(token: string): boolean {
  const base = basenameCommand(token);
  return (
    /^\.tmp/i.test(base) ||
    /^(?:fix|patch|write|edit)[-_].*\.(?:js|mjs|cjs|ts|py)$/i.test(base) ||
    /\.tmp[-_].*\.(?:js|mjs|cjs|ts|py)$/i.test(base)
  );
}
