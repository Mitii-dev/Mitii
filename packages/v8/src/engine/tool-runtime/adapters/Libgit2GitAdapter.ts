/**
 * libgit2-backed GitPort (via optional `es-git` N-API bindings).
 * Hot paths: status. Diff/log/show/branches fall through to a CLI delegate.
 */

import type {
  GitBranchListResult,
  GitDiffResult,
  GitLogResult,
  GitPort,
  GitShowResult,
  GitStatusResult,
} from "../contracts";
import { gitStatusPathsFromPorcelain, parseGitPorcelain } from "../internal/git";

type EsGitStatusFlags = {
  isIndexNew?: () => boolean;
  isIndexModified?: () => boolean;
  isIndexDeleted?: () => boolean;
  isIndexRenamed?: () => boolean;
  isIndexTypechange?: () => boolean;
  isWtNew?: () => boolean;
  isWtModified?: () => boolean;
  isWtDeleted?: () => boolean;
  isWtTypechange?: () => boolean;
  isWtRenamed?: () => boolean;
  isIgnored?: () => boolean;
};

type EsGitModule = {
  openRepository: (path: string) => Promise<{
    statuses: (options?: {
      includeUntracked?: boolean;
      recurseUntrackedDirs?: boolean;
      includeIgnored?: boolean;
    }) => Array<{
      path: () => string;
      status: () => EsGitStatusFlags;
    }>;
    head: () => {
      shorthandle?: () => string;
      name?: () => string;
      shorthand?: () => string;
    };
  }>;
};

async function loadEsGit(): Promise<EsGitModule | undefined> {
  try {
    const mod = (await import("es-git")) as EsGitModule;
    if (typeof mod.openRepository !== "function") return undefined;
    return mod;
  } catch {
    return undefined;
  }
}

export class Libgit2GitAdapter implements GitPort {
  private esGit: EsGitModule | undefined | null = null;
  private unavailable = false;

  constructor(
    private readonly fallback: GitPort,
    _options: { maxOutputBytes?: number } = {},
  ) {}

  public async status(params: {
    workspaceRoot: string;
    signal?: AbortSignal;
  }): Promise<GitStatusResult> {
    const esGit = await this.ensureEsGit();
    if (!esGit) {
      return this.fallback.status(params);
    }
    try {
      const repo = await esGit.openRepository(params.workspaceRoot);
      const statuses = repo.statuses({
        includeUntracked: true,
        recurseUntrackedDirs: true,
        includeIgnored: false,
      });
      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];

      for (const entry of statuses) {
        const path = entry.path();
        const status = entry.status();
        if (status.isIgnored?.()) continue;
        const indexDirty =
          status.isIndexNew?.() ||
          status.isIndexModified?.() ||
          status.isIndexDeleted?.() ||
          status.isIndexRenamed?.() ||
          status.isIndexTypechange?.();
        const wtDirty =
          status.isWtModified?.() ||
          status.isWtDeleted?.() ||
          status.isWtTypechange?.() ||
          status.isWtRenamed?.();
        const isUntracked = status.isWtNew?.();
        if (indexDirty) staged.push(path);
        if (isUntracked) untracked.push(path);
        else if (wtDirty) unstaged.push(path);
      }

      let branch: string | undefined;
      try {
        const head = repo.head();
        branch =
          head.shorthand?.() ??
          head.shorthandle?.() ??
          head.name?.()?.replace(/^refs\/heads\//, "");
      } catch {
        branch = undefined;
      }

      return {
        ...(branch ? { branch } : {}),
        staged,
        unstaged,
        untracked,
        raw: [
          branch ? `## ${branch}` : "## HEAD",
          ...staged.map((p) => `M  ${p}`),
          ...unstaged.map((p) => ` M ${p}`),
          ...untracked.map((p) => `?? ${p}`),
        ].join("\n"),
      };
    } catch {
      this.unavailable = true;
      return this.fallback.status(params);
    }
  }

  public async diff(params: {
    workspaceRoot: string;
    paths?: readonly string[];
    staged?: boolean;
    signal?: AbortSignal;
  }): Promise<GitDiffResult> {
    return this.fallback.diff(params);
  }

  public async log?(params: {
    workspaceRoot: string;
    maxCount?: number;
    paths?: readonly string[];
    nameOnly?: boolean;
    signal?: AbortSignal;
  }): Promise<GitLogResult> {
    if (!this.fallback.log) {
      return { entries: [], truncated: false };
    }
    return this.fallback.log(params);
  }

  public async show?(params: {
    workspaceRoot: string;
    revision: string;
    path?: string;
    signal?: AbortSignal;
  }): Promise<GitShowResult> {
    if (!this.fallback.show) {
      return {
        revision: params.revision,
        content: "",
        truncated: false,
      };
    }
    return this.fallback.show(params);
  }

  public async listBranches?(params: {
    workspaceRoot: string;
    signal?: AbortSignal;
  }): Promise<GitBranchListResult> {
    if (!this.fallback.listBranches) {
      return { branches: [], truncated: false };
    }
    return this.fallback.listBranches(params);
  }

  private async ensureEsGit(): Promise<EsGitModule | undefined> {
    if (this.unavailable) return undefined;
    if (this.esGit === null) {
      this.esGit = await loadEsGit();
      if (!this.esGit) this.unavailable = true;
    }
    return this.esGit ?? undefined;
  }
}

/** Test helper: map porcelain through the shared parser (parity with CLI). */
export function statusFromPorcelainRaw(raw: string): GitStatusResult {
  return gitStatusPathsFromPorcelain(parseGitPorcelain(raw), raw);
}
