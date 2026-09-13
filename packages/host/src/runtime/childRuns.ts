import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import type { AgentMode, UserSafetyRules } from '@mitii/v8';

const MODE_RANK: Record<AgentMode, number> = {
  ask: 0,
  plan: 1,
  agent: 2,
};

export interface NarrowChildStartInputParams {
  /** Deny tools inherited from the parent grant (intersect-only). */
  parentGrantDenyTools?: readonly string[];
  parentMode: AgentMode;
  childMode: AgentMode;
  childPrompt: string;
  workspaceRoot: string;
  /**
   * Master switch. Must be explicitly true — child runs stay off by default.
   */
  enabled?: boolean;
}

export interface NarrowedChildStartInput {
  mode: AgentMode;
  prompt: string;
  workspaceRoot: string;
  userSafetyRules: UserSafetyRules;
}

/**
 * Narrow a child-run start payload so the child cannot escalate past the parent.
 * Never widens ToolGrant — only emits tighten-only `userSafetyRules`.
 */
export function narrowChildStartInput(
  params: NarrowChildStartInputParams,
): NarrowedChildStartInput {
  if (params.enabled !== true) {
    throw new Error(
      'Child runs are disabled. Pass enabled: true to opt in (default off).',
    );
  }

  if (MODE_RANK[params.childMode] > MODE_RANK[params.parentMode]) {
    throw new Error(
      `Child mode "${params.childMode}" cannot escalate above parent mode "${params.parentMode}" (ask < plan < agent).`,
    );
  }

  const denyTools = uniqueNonEmpty([...(params.parentGrantDenyTools ?? [])]);
  const userSafetyRules: UserSafetyRules = {
    enabled: denyTools.length > 0,
    denyTools,
    denyCommandPrefixes: [],
    denyPathScopes: [],
    denyNetworkHosts: [],
  };

  return {
    mode: params.childMode,
    prompt: params.childPrompt,
    workspaceRoot: params.workspaceRoot,
    userSafetyRules,
  };
}

/**
 * Suggest (and create) a worktree directory under `.mitii/worktrees/<id>`.
 * Does not invoke `git worktree`; callers may bind git separately.
 */
export async function createChildWorktreePath(input: {
  workspaceRoot: string;
  id?: string;
}): Promise<{ id: string; path: string }> {
  const id =
    input.id?.trim() ||
    `child_${randomBytes(4).toString('hex')}_${Date.now().toString(36)}`;
  const path = join(input.workspaceRoot, '.mitii', 'worktrees', id);
  await mkdir(path, { recursive: true });
  return { id, path };
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
