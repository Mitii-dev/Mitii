/**
 * Host-owned session hooks (Phase 3).
 * Restrict-only: may deny tools/command prefixes and audit — never add tools
 * or raise autonomy. Disabled when `.mitii/hooks/` is absent.
 */

import { z } from 'zod';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const HOOK_SPEC_SCHEMA_VERSION = 1 as const;

export const hookSpecSchema = z
  .object({
    schemaVersion: z.literal(HOOK_SPEC_SCHEMA_VERSION),
    id: z.string().min(1).max(64),
    on: z.enum(['session_start', 'pre_tool', 'post_tool', 'run_complete']),
    /** Intersect-deny tool names (same semantics as .mitii/safety.json). */
    denyTools: z.array(z.string().min(1).max(128)).max(64).default([]),
    denyCommandPrefixes: z
      .array(z.string().min(1).max(128))
      .max(64)
      .default([]),
    /** When true, emit audit lines via the host observer. */
    audit: z.boolean().default(true),
    enabled: z.boolean().default(true),
  })
  .strict();

export type HookSpec = z.infer<typeof hookSpecSchema>;

export interface LoadedHooks {
  specs: HookSpec[];
  /** Merged deny lists for start-input userSafetyRules intersection. */
  denyTools: string[];
  denyCommandPrefixes: string[];
}

export async function loadWorkspaceHooks(params: {
  workspaceRoot: string;
  /** Master switch; default false until hosts enable. */
  enabled?: boolean;
}): Promise<LoadedHooks> {
  if (params.enabled !== true) {
    return { specs: [], denyTools: [], denyCommandPrefixes: [] };
  }

  const dir = join(params.workspaceRoot, '.mitii', 'hooks');
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return { specs: [], denyTools: [], denyCommandPrefixes: [] };
  }

  const specs: HookSpec[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(dir, name), 'utf8');
      const parsed = hookSpecSchema.parse(JSON.parse(raw));
      if (parsed.enabled) {
        specs.push(parsed);
      }
    } catch {
      // Invalid hook files are skipped (fail soft for org config).
    }
  }

  const denyTools = [
    ...new Set(specs.flatMap((s) => s.denyTools)),
  ];
  const denyCommandPrefixes = [
    ...new Set(specs.flatMap((s) => s.denyCommandPrefixes)),
  ];
  return { specs, denyTools, denyCommandPrefixes };
}

/**
 * Pre-tool deny check for run_command argv / tool name.
 * Returns a BLOCK reason or undefined when allowed.
 */
export function evaluatePreToolHooks(params: {
  hooks: LoadedHooks;
  toolName: string;
  /** Joined argv or command string when tool is run_command. */
  commandText?: string;
}): { blocked: true; reason: string; hookId: string } | { blocked: false } {
  const pre = params.hooks.specs.filter((s) => s.on === 'pre_tool');
  for (const hook of pre) {
    if (hook.denyTools.includes(params.toolName)) {
      return {
        blocked: true,
        reason: `Hook "${hook.id}" denies tool "${params.toolName}"`,
        hookId: hook.id,
      };
    }
    if (params.commandText && hook.denyCommandPrefixes.length > 0) {
      const lower = params.commandText.trim().toLowerCase();
      for (const prefix of hook.denyCommandPrefixes) {
        if (lower.startsWith(prefix.trim().toLowerCase())) {
          return {
            blocked: true,
            reason: `Hook "${hook.id}" denies command prefix "${prefix}"`,
            hookId: hook.id,
          };
        }
      }
    }
  }
  return { blocked: false };
}

/** Sample deny-git-push hook document for docs / scaffolding. */
export const SAMPLE_PRE_TOOL_DENY_GIT_PUSH: HookSpec = {
  schemaVersion: 1,
  id: 'deny-git-push',
  on: 'pre_tool',
  denyTools: [],
  denyCommandPrefixes: ['git push', 'kubectl delete'],
  audit: true,
  enabled: true,
};
