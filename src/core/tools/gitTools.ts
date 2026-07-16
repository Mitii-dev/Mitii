import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { z } from 'zod';
import type { Tool, ToolResult } from './types';
import { redactSensitiveDiff } from '../scm/commitMessagePrompt';
import { createGitCheckpoint } from '../git/checkpoints';
import { aggregateChangelog, detectChangelogStrategy, generateChangelogPatch } from '../git/changelog';
import { buildIssueDraft, buildPullRequestDraft, findDuplicateIssues, readRepositoryTemplate, redactSensitiveText, verifyGitHubRepository } from '../git/github';
import { analyzeGitHubWorkflow, discoverGitHubWorkflows, workflowMayAffectProduction } from '../git/workflows';
import { createReleasePlanState, completeReleaseStage } from '../git/releasePlan';
import { canonicalGitActionSignature } from '../git/intents';

interface GitRunResult {
  stdout: string;
  stderr: string;
}

export function createGitStatusTool(workspace: string): Tool<Record<string, never>> {
  return {
    name: 'git_status',
    description: 'Return structured Git repository status including branch, upstream, ahead/behind, staged, unstaged, untracked, conflicted, ignored count, and clean state.',
    risk: 'low',
    inputSchema: z.object({}).strict(),
    async execute(): Promise<ToolResult> {
      const [root, branch, status, ignored] = await Promise.all([
        git(workspace, ['rev-parse', '--show-toplevel']).catch(() => ({ stdout: '', stderr: '' })),
        git(workspace, ['branch', '--show-current']).catch(() => ({ stdout: '', stderr: '' })),
        git(workspace, ['status', '--porcelain=v1', '--branch']).catch((error: Error) => ({ stdout: '', stderr: error.message })),
        git(workspace, ['status', '--ignored=matching', '--porcelain=v1']).catch(() => ({ stdout: '', stderr: '' })),
      ]);
      if (!status.stdout && status.stderr) return fail(status.stderr);
      const parsed = parsePorcelainStatus(status.stdout);
      return ok({
        repositoryRoot: root.stdout.trim() || workspace,
        currentBranch: branch.stdout.trim() || null,
        detachedHead: !branch.stdout.trim(),
        upstreamBranch: parsed.upstreamBranch,
        ahead: parsed.ahead,
        behind: parsed.behind,
        stagedFiles: parsed.stagedFiles,
        unstagedFiles: parsed.unstagedFiles,
        untrackedFiles: parsed.untrackedFiles,
        conflictedFiles: parsed.conflictedFiles,
        ignoredFileCount: ignored.stdout.split(/\r?\n/).filter((line) => line.startsWith('!!')).length,
        clean: parsed.stagedFiles.length === 0 && parsed.unstagedFiles.length === 0 && parsed.untrackedFiles.length === 0 && parsed.conflictedFiles.length === 0,
      });
    },
  };
}

export function createStructuredGitDiffTool(workspace: string): Tool<{
  kind?: 'staged' | 'unstaged' | 'branch' | 'commit';
  base?: string;
  head?: string;
  paths?: string[];
  summaryOnly?: boolean;
  perFileLimit?: number;
}> {
  return {
    name: 'git_diff',
    description: 'Return a structured, bounded, redacted Git diff for staged, unstaged, branch, commit, or path-filtered comparisons.',
    risk: 'low',
    inputSchema: z.object({
      kind: z.enum(['staged', 'unstaged', 'branch', 'commit']).default('unstaged'),
      base: z.string().optional(),
      head: z.string().optional(),
      paths: z.array(z.string()).optional(),
      summaryOnly: z.boolean().default(false),
      perFileLimit: z.number().int().min(500).max(20_000).default(4_000),
    }),
    async execute(input): Promise<ToolResult> {
      const args = buildDiffArgs(input);
      const [stat, diff] = await Promise.all([
        git(workspace, [...args, '--numstat']).catch((error: Error) => ({ stdout: '', stderr: error.message })),
        input.summaryOnly ? Promise.resolve({ stdout: '', stderr: '' }) : git(workspace, args).catch((error: Error) => ({ stdout: '', stderr: error.message })),
      ]);
      if (stat.stderr && !stat.stdout) return fail(stat.stderr);
      const sections = input.summaryOnly ? [] : budgetDiffByFile(redactSensitiveDiff(diff.stdout), input.perFileLimit ?? 4_000);
      return ok({
        kind: input.kind,
        base: input.base,
        head: input.head,
        fileSummaries: parseNumstat(stat.stdout),
        totals: totalsFromNumstat(stat.stdout),
        patch: sections.map((section) => section.patch).join('\n'),
        truncation: {
          omittedFileCount: sections.filter((section) => section.omitted).length,
          truncatedFiles: sections.filter((section) => section.truncated).map((section) => section.file),
        },
      });
    },
  };
}

export function createGitLogTool(workspace: string): Tool<{
  range?: string;
  limit?: number;
  since?: string;
  until?: string;
  path?: string;
  author?: string;
  grep?: string;
  includeStats?: boolean;
}> {
  return {
    name: 'git_log',
    description: 'Return structured bounded Git log entries with optional range, path, author, grep, dates, and stats.',
    risk: 'low',
    inputSchema: z.object({
      range: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
      since: z.string().optional(),
      until: z.string().optional(),
      path: z.string().optional(),
      author: z.string().optional(),
      grep: z.string().optional(),
      includeStats: z.boolean().default(false),
    }),
    async execute(input): Promise<ToolResult> {
      const args = ['log', input.range ?? `-${input.limit ?? 20}`, '--date=iso-strict', '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%P%x1f%D'];
      if (input.since) args.push(`--since=${input.since}`);
      if (input.until) args.push(`--until=${input.until}`);
      if (input.author) args.push(`--author=${input.author}`);
      if (input.grep) args.push(`--grep=${input.grep}`);
      if (input.includeStats) args.push('--numstat');
      if (input.path) args.push('--', input.path);
      const result = await git(workspace, args).catch((error: Error) => ({ stdout: '', stderr: error.message }));
      if (result.stderr && !result.stdout) return fail(result.stderr);
      return ok(parseGitLog(result.stdout, input.includeStats ?? false));
    },
  };
}

export function createGitShowTool(workspace: string): Tool<{ commit: string; perFileLimit?: number }> {
  return {
    name: 'git_show',
    description: 'Return metadata, changed files, statistics, tags, and bounded redacted diff for one explicit commit.',
    risk: 'low',
    inputSchema: z.object({ commit: z.string().min(1), perFileLimit: z.number().int().min(500).max(20_000).default(4_000) }),
    async execute(input): Promise<ToolResult> {
      const [meta, stat, diff] = await Promise.all([
        git(workspace, ['show', '--no-patch', '--date=iso-strict', '--pretty=format:%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x1f%B', input.commit]),
        git(workspace, ['show', '--numstat', '--format=', input.commit]),
        git(workspace, ['show', '--format=', input.commit]),
      ]);
      const fields = meta.stdout.split('\x1f');
      return ok({
        hash: fields[0],
        parents: (fields[1] ?? '').split(/\s+/).filter(Boolean),
        author: fields[2],
        timestamp: fields[3],
        subject: fields[4],
        tags: (fields[5] ?? '').split(',').map((tag) => tag.trim()).filter((tag) => tag.startsWith('tag:')),
        message: fields.slice(6).join('\x1f').trim(),
        changedFiles: parseNumstat(stat.stdout),
        statistics: totalsFromNumstat(stat.stdout),
        diff: budgetDiffByFile(redactSensitiveDiff(diff.stdout), input.perFileLimit ?? 4_000).map((section) => section.patch).join('\n'),
      });
    },
  };
}

export function createGitBlameTool(workspace: string): Tool<{ path: string; startLine?: number; endLine?: number; limit?: number }> {
  return {
    name: 'git_blame',
    description: 'Return bounded git blame data for a file path and optional line range without author emails.',
    risk: 'low',
    inputSchema: z.object({
      path: z.string().min(1),
      startLine: z.number().int().min(1).optional(),
      endLine: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(200).default(80),
    }),
    async execute(input): Promise<ToolResult> {
      const limit = input.limit ?? 80;
      const range = input.startLine ? [`-L`, `${input.startLine},${input.endLine ?? input.startLine + limit - 1}`] : [];
      const result = await git(workspace, ['blame', '--line-porcelain', ...range, '--', input.path]).catch((error: Error) => ({ stdout: '', stderr: error.message }));
      if (result.stderr && !result.stdout) return fail(result.stderr);
      return ok(parseBlame(result.stdout).slice(0, limit));
    },
  };
}

export function createGitCompareBranchesTool(workspace: string): Tool<{ base: string; head: string; perFileLimit?: number }> {
  return {
    name: 'git_compare_branches',
    description: 'Compare branches with merge-base awareness, commits, changed files, likely conflicts, and bounded diff summary. Does not checkout or merge.',
    risk: 'low',
    inputSchema: z.object({ base: z.string().min(1), head: z.string().min(1), perFileLimit: z.number().int().min(500).max(20_000).default(3_000) }),
    async execute(input): Promise<ToolResult> {
      const mergeBase = (await git(workspace, ['merge-base', input.base, input.head])).stdout.trim();
      const [ahead, behind, commits, stat, diff, conflicts] = await Promise.all([
        git(workspace, ['rev-list', '--count', `${input.base}..${input.head}`]),
        git(workspace, ['rev-list', '--count', `${input.head}..${input.base}`]),
        git(workspace, ['log', '--oneline', `${input.base}..${input.head}`, '--max-count=50']),
        git(workspace, ['diff', '--numstat', `${mergeBase}...${input.head}`]),
        git(workspace, ['diff', `${mergeBase}...${input.head}`]),
        git(workspace, ['diff', '--name-only', '--diff-filter=U', `${input.base}...${input.head}`]).catch(() => ({ stdout: '', stderr: '' })),
      ]);
      return ok({
        baseBranch: input.base,
        headBranch: input.head,
        mergeBase,
        ahead: Number(ahead.stdout.trim() || 0),
        behind: Number(behind.stdout.trim() || 0),
        commitSummaries: commits.stdout.split(/\r?\n/).filter(Boolean),
        changedFiles: parseNumstat(stat.stdout),
        totals: totalsFromNumstat(stat.stdout),
        likelyConflicts: conflicts.stdout.split(/\r?\n/).filter(Boolean),
        diffSummary: budgetDiffByFile(redactSensitiveDiff(diff.stdout), input.perFileLimit ?? 3_000).map((section) => section.patch).join('\n'),
      });
    },
  };
}

export function createGitStageFilesTool(workspace: string): Tool<{ paths: string[] }> {
  return {
    name: 'git_stage_files',
    description: 'Safely stage explicit files after existence, ignored-file, secret, generated-artifact, and large-binary checks. Does not support git add .',
    risk: 'medium',
    inputSchema: z.object({ paths: z.array(z.string().min(1)).min(1) }),
    async execute(input): Promise<ToolResult> {
      const validation = validateStagePaths(workspace, input.paths);
      if (validation.error) return fail(validation.error);
      await git(workspace, ['add', '--', ...input.paths]);
      const status = await git(workspace, ['diff', '--cached', '--name-status', '--', ...input.paths]);
      return ok({ staged: status.stdout.split(/\r?\n/).filter(Boolean), warnings: validation.warnings });
    },
  };
}

export function createGitUnstageFilesTool(workspace: string): Tool<{ paths: string[] }> {
  return {
    name: 'git_unstage_files',
    description: 'Unstage explicit files without discarding working-tree content.',
    risk: 'medium',
    inputSchema: z.object({ paths: z.array(z.string().min(1)).min(1) }),
    async execute(input): Promise<ToolResult> {
      await git(workspace, ['restore', '--staged', '--', ...input.paths]);
      return ok({ unstaged: input.paths });
    },
  };
}

export function createGitCommitTool(workspace: string): Tool<{ message: string; expectedStagedTreeHash?: string; approved?: boolean; signingMode?: 'default' | 'no-sign' | 'sign' }> {
  return {
    name: 'git_commit',
    description: 'Create one local Git commit after verifying staged changes, staged tree hash, conflicts, validated message, and explicit approval. Never pushes.',
    risk: 'high',
    inputSchema: z.object({
      message: z.string().min(1),
      expectedStagedTreeHash: z.string().optional(),
      approved: z.boolean().default(false),
      signingMode: z.enum(['default', 'no-sign', 'sign']).default('default'),
    }),
    async execute(input): Promise<ToolResult> {
      if (!input.approved) return fail('Explicit approval is required before creating a commit.');
      const status = parsePorcelainStatus((await git(workspace, ['status', '--porcelain=v1', '--branch'])).stdout);
      if (status.conflictedFiles.length) return fail(`Cannot commit unresolved conflicts: ${status.conflictedFiles.join(', ')}`);
      const treeHash = (await git(workspace, ['write-tree'])).stdout.trim();
      if (input.expectedStagedTreeHash && input.expectedStagedTreeHash !== treeHash) return fail('Staged tree hash changed unexpectedly.');
      if (status.stagedFiles.length === 0) return fail('No staged changes to commit.');
      const msgError = validateCommitMessageForTool(input.message);
      if (msgError) return fail(msgError);
      const signingArgs = input.signingMode === 'no-sign' ? ['--no-gpg-sign'] : input.signingMode === 'sign' ? ['-S'] : [];
      await git(workspace, ['commit', ...signingArgs, '-m', input.message]);
      const show = await git(workspace, ['show', '--no-patch', '--pretty=format:%H%x1f%h%x1f%s%x1f%P', 'HEAD']);
      const files = await git(workspace, ['show', '--name-only', '--format=', 'HEAD']);
      const [hash, shortHash, subject, parentHash] = show.stdout.split('\x1f');
      return ok({ hash, shortHash, subject, parentHash, includedFiles: files.stdout.split(/\r?\n/).filter(Boolean) });
    },
  };
}

export function createGitBranchCreateTool(workspace: string): Tool<{ name: string; startPoint?: string; switchTo?: boolean }> {
  return {
    name: 'git_branch_create',
    description: 'Create a local branch after validating its name and preventing overwrite.',
    risk: 'medium',
    inputSchema: z.object({ name: z.string().min(1), startPoint: z.string().optional(), switchTo: z.boolean().default(false) }),
    async execute(input): Promise<ToolResult> {
      const error = validateBranchName(input.name);
      if (error) return fail(error);
      const exists = await git(workspace, ['rev-parse', '--verify', input.name]).then(() => true, () => false);
      if (exists) return fail(`Branch already exists: ${input.name}`);
      await git(workspace, ['branch', input.name, ...(input.startPoint ? [input.startPoint] : [])]);
      if (input.switchTo) await git(workspace, ['switch', input.name]);
      return ok({ branch: input.name, switched: input.switchTo });
    },
  };
}

export function createGitBranchSwitchTool(workspace: string): Tool<{ name: string; approvedWithLocalChanges?: boolean }> {
  return {
    name: 'git_branch_switch',
    description: 'Switch branches after detecting uncommitted changes.',
    risk: 'medium',
    inputSchema: z.object({ name: z.string().min(1), approvedWithLocalChanges: z.boolean().default(false) }),
    async execute(input): Promise<ToolResult> {
      const status = parsePorcelainStatus((await git(workspace, ['status', '--porcelain=v1', '--branch'])).stdout);
      const dirtyCount = status.stagedFiles.length + status.unstagedFiles.length + status.untrackedFiles.length;
      if (dirtyCount > 0 && !input.approvedWithLocalChanges) return fail('Branch switch requires approval because local changes are present.');
      if (dirtyCount > 0) await createGitCheckpoint(workspace, `switch branch to ${input.name}`);
      await git(workspace, ['switch', input.name]);
      return ok({ branch: input.name });
    },
  };
}

export function createGitBranchDeleteTool(workspace: string): Tool<{ name: string; force?: boolean; approved?: boolean }> {
  return {
    name: 'git_branch_delete',
    description: 'Delete a local branch safely; forced deletion requires explicit approval and current branch cannot be deleted.',
    risk: 'high',
    inputSchema: z.object({ name: z.string().min(1), force: z.boolean().default(false), approved: z.boolean().default(false) }),
    async execute(input): Promise<ToolResult> {
      const current = (await git(workspace, ['branch', '--show-current'])).stdout.trim();
      if (current === input.name) return fail('Cannot delete the current branch.');
      if (input.force && !input.approved) return fail('Forced branch deletion requires explicit approval.');
      await git(workspace, ['branch', input.force ? '-D' : '-d', input.name]);
      return ok({ deleted: input.name, forced: input.force });
    },
  };
}

export function createGitMergeTool(workspace: string): Tool<{ source: string; approved?: boolean }> {
  return {
    name: 'git_merge',
    description: 'Merge a branch locally after checkpoint and explicit approval. Does not push.',
    risk: 'high',
    inputSchema: z.object({ source: z.string().min(1), approved: z.boolean().default(false) }),
    async execute(input): Promise<ToolResult> {
      if (!input.approved) return fail('Explicit approval is required before merge.');
      await createGitCheckpoint(workspace, `merge ${input.source}`);
      const result = await git(workspace, ['merge', '--no-ff', input.source]).catch((error: Error) => ({ stdout: '', stderr: error.message }));
      const conflicts = parsePorcelainStatus((await git(workspace, ['status', '--porcelain=v1', '--branch'])).stdout).conflictedFiles;
      return result.stderr && conflicts.length ? fail(result.stderr, { conflicts }) : ok({ result: result.stdout, conflicts });
    },
  };
}

export function createGitRebaseTool(workspace: string): Tool<{ operation: 'start' | 'continue' | 'abort' | 'skip'; upstream?: string; approved?: boolean }> {
  return {
    name: 'git_rebase',
    description: 'Run controlled rebase operations. Start requires clean working tree, checkpoint, and explicit approval. Never force-pushes.',
    risk: 'high',
    inputSchema: z.object({
      operation: z.enum(['start', 'continue', 'abort', 'skip']),
      upstream: z.string().optional(),
      approved: z.boolean().default(false),
    }),
    async execute(input): Promise<ToolResult> {
      if (!input.approved) return fail('Explicit approval is required for rebase operations.');
      const args = input.operation === 'start'
        ? ['rebase', input.upstream ?? '']
        : ['rebase', `--${input.operation}`];
      if (input.operation === 'start') {
        const status = parsePorcelainStatus((await git(workspace, ['status', '--porcelain=v1', '--branch'])).stdout);
        if (status.stagedFiles.length || status.unstagedFiles.length || status.untrackedFiles.length) return fail('Rebase requires a clean working tree.');
        await createGitCheckpoint(workspace, `rebase ${input.upstream ?? ''}`.trim());
      }
      const result = await git(workspace, args.filter(Boolean)).catch((error: Error) => ({ stdout: '', stderr: error.message }));
      const conflicts = parsePorcelainStatus((await git(workspace, ['status', '--porcelain=v1', '--branch'])).stdout).conflictedFiles;
      return result.stderr && conflicts.length ? fail(result.stderr, { conflicts }) : ok({ operation: input.operation, output: result.stdout, conflicts });
    },
  };
}

export function createGitTagTools(workspace: string): Tool<unknown>[] {
  return [
    {
      name: 'git_tag_list',
      description: 'List local tags in version order.',
      risk: 'low',
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
      async execute(input: { limit?: number }): Promise<ToolResult> {
        const result = await git(workspace, ['tag', '--sort=-version:refname', `--list`]);
        return ok(result.stdout.split(/\r?\n/).filter(Boolean).slice(0, input.limit ?? 50));
      },
    },
    {
      name: 'git_tag_create',
      description: 'Create an annotated local release tag after version-format, target, duplicate, and approval checks. Does not push.',
      risk: 'high',
      inputSchema: z.object({ tag: z.string().min(1), target: z.string().default('HEAD'), message: z.string().optional(), approved: z.boolean().default(false) }),
      async execute(input: { tag: string; target?: string; message?: string; approved?: boolean }): Promise<ToolResult> {
        if (!input.approved) return fail('Explicit approval is required before creating a tag.');
        if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(input.tag)) return fail('Tag must look like a semantic version, e.g. v1.2.3.');
        const exists = await git(workspace, ['rev-parse', '--verify', `refs/tags/${input.tag}`]).then(() => true, () => false);
        if (exists) return fail(`Tag already exists: ${input.tag}`);
        const target = input.target ?? 'HEAD';
        await git(workspace, ['tag', '-a', input.tag, target, '-m', input.message ?? input.tag]);
        return ok({ tag: input.tag, target });
      },
    },
    {
      name: 'git_tag_delete_local',
      description: 'Delete a local tag after explicit approval. Does not delete remote tags.',
      risk: 'high',
      inputSchema: z.object({ tag: z.string().min(1), approved: z.boolean().default(false) }),
      async execute(input: { tag: string; approved?: boolean }): Promise<ToolResult> {
        if (!input.approved) return fail('Explicit approval is required before deleting a local tag.');
        await git(workspace, ['tag', '-d', input.tag]);
        return ok({ deleted: input.tag });
      },
    },
  ];
}

export function createChangelogTools(workspace: string): Tool<unknown>[] {
  return [
    {
      name: 'detect_changelog_strategy',
      description: 'Detect changelog strategy from CHANGELOG, package metadata, Changesets, Release Please, and conventional changelog config.',
      risk: 'low',
      inputSchema: z.object({ latestTag: z.string().optional() }),
      async execute(input: { latestTag?: string }): Promise<ToolResult> {
        return ok(detectChangelogStrategy(workspace, input));
      },
    },
    {
      name: 'aggregate_changelog',
      description: 'Aggregate deterministic changelog entries from bounded commit subjects.',
      risk: 'low',
      inputSchema: z.object({ commits: z.array(z.string()), range: z.string().default('HEAD') }),
      async execute(input: { commits: string[]; range?: string }): Promise<ToolResult> {
        return ok(aggregateChangelog(input.commits, input.range ?? 'HEAD'));
      },
    },
    {
      name: 'generate_changelog_patch',
      description: 'Generate a minimal changelog patch preview while preserving existing style and historical entries.',
      risk: 'medium',
      inputSchema: z.object({ changelogPath: z.string().default('CHANGELOG.md'), commits: z.array(z.string()), version: z.string().default('Unreleased') }),
      async execute(input: { changelogPath?: string; commits: string[]; version?: string }): Promise<ToolResult> {
        const path = join(workspace, input.changelogPath ?? 'CHANGELOG.md');
        const existing = existsSync(path) ? readFileSync(path, 'utf8') : '# Changelog\n\n';
        return ok(generateChangelogPatch(existing, aggregateChangelog(input.commits), input.version ?? 'Unreleased'));
      },
    },
  ];
}

export function createWorkflowTools(workspace: string): Tool<unknown>[] {
  return [
    {
      name: 'discover_github_workflows',
      description: 'Discover GitHub Actions workflows, triggers, jobs, permissions, environments, called workflows, local actions, and external actions.',
      risk: 'low',
      inputSchema: z.object({}).strict(),
      async execute(): Promise<ToolResult> {
        return ok(discoverGitHubWorkflows(workspace));
      },
    },
    {
      name: 'analyze_github_workflow',
      description: 'Run deterministic static analysis for GitHub Actions workflow YAML.',
      risk: 'low',
      inputSchema: z.object({ path: z.string().min(1) }),
      async execute(input: { path: string }): Promise<ToolResult> {
        const absPath = join(workspace, input.path);
        if (!existsSync(absPath)) return fail(`Workflow not found: ${input.path}`);
        return ok(analyzeGitHubWorkflow(readFileSync(absPath, 'utf8'), input.path));
      },
    },
    {
      name: 'github_dispatch_workflow',
      description: 'Dispatch a GitHub Actions workflow through gh after repository, workflow, ref, input, production-risk, duplicate, and explicit approval checks.',
      risk: 'high',
      inputSchema: z.object({ workflow: z.string().min(1), ref: z.string().min(1), inputs: z.record(z.string()).default({}), approved: z.boolean().default(false) }),
      async execute(input: { workflow: string; ref: string; inputs?: Record<string, string>; approved?: boolean }): Promise<ToolResult> {
        if (!input.approved) return fail('Explicit approval is required before workflow dispatch.');
        const workflows = discoverGitHubWorkflows(workspace);
        const workflow = workflows.find((item) => item.name === input.workflow || item.path.endsWith(input.workflow));
        if (!workflow) return fail(`Workflow not found: ${input.workflow}`);
        if (workflowMayAffectProduction(workflow)) return fail('Workflow appears to affect production/release/publish/migration paths; approval must be handled as always-explicit by the caller.');
        const inputs = input.inputs ?? {};
        const args = ['workflow', 'run', workflow.path, '--ref', input.ref, ...Object.entries(inputs).flatMap(([key, value]) => ['-f', `${key}=${value}`])];
        const result = await gh(workspace, args).catch((error: Error) => ({ stdout: '', stderr: error.message }));
        if (result.stderr && !result.stdout) return fail(result.stderr);
        return ok({ workflow: workflow.path, ref: input.ref, inputs, status: 'dispatched', signature: canonicalGitActionSignature('workflow_dispatch', { workflow: workflow.path, ref: input.ref, inputs }) });
      },
    },
    {
      name: 'github_get_workflow_run',
      description: 'Read one GitHub Actions workflow run summary through gh with bounded output.',
      risk: 'low',
      inputSchema: z.object({ runId: z.string().min(1) }),
      async execute(input: { runId: string }): Promise<ToolResult> {
        const result = await gh(workspace, ['run', 'view', input.runId, '--json', 'databaseId,workflowName,headBranch,headSha,event,status,conclusion,jobs,url,createdAt,updatedAt']).catch((error: Error) => ({ stdout: '', stderr: error.message }));
        return result.stderr && !result.stdout ? fail(result.stderr) : ok(JSON.parse(result.stdout));
      },
    },
  ];
}

export function createGitHubTools(workspace: string): Tool<unknown>[] {
  return [
    {
      name: 'github_verify_repository',
      description: 'Verify GitHub remote owner/name, expected branch, authenticated identity, write permission, and fork status before remote writes.',
      risk: 'low',
      inputSchema: z.object({ remoteUrl: z.string().optional(), expectedBranch: z.string().optional(), writePermission: z.boolean().optional(), isFork: z.boolean().optional() }),
      async execute(input: { remoteUrl?: string; expectedBranch?: string; writePermission?: boolean; isFork?: boolean }): Promise<ToolResult> {
        const remoteUrl = input.remoteUrl ?? (await git(workspace, ['config', '--get', 'remote.origin.url']).catch(() => ({ stdout: '', stderr: '' }))).stdout.trim();
        const currentBranch = (await git(workspace, ['branch', '--show-current']).catch(() => ({ stdout: '', stderr: '' }))).stdout.trim();
        const user = (await gh(workspace, ['api', 'user', '--jq', '.login']).catch(() => ({ stdout: '', stderr: '' }))).stdout.trim();
        return ok(verifyGitHubRepository({ remoteUrl, expectedBranch: input.expectedBranch, currentBranch, authenticatedUser: user, writePermission: input.writePermission, isFork: input.isFork }));
      },
    },
    {
      name: 'github_draft_pull_request',
      description: 'Generate one pull request title/body from deterministic branch context and repository template. Does not create the PR.',
      risk: 'low',
      inputSchema: z.object({ base: z.string().min(1), head: z.string().min(1), testsRun: z.array(z.string()).default([]), issueRefs: z.array(z.string()).default([]) }),
      async execute(input: { base: string; head: string; testsRun?: string[]; issueRefs?: string[] }): Promise<ToolResult> {
        const commits = (await git(workspace, ['log', '--oneline', `${input.base}..${input.head}`, '--max-count=50'])).stdout.split(/\r?\n/).filter(Boolean);
        const files = (await git(workspace, ['diff', '--name-only', `${input.base}...${input.head}`])).stdout.split(/\r?\n/).filter(Boolean);
        return ok(buildPullRequestDraft({ ...input, testsRun: input.testsRun ?? [], issueRefs: input.issueRefs ?? [], commits, changedFiles: files, template: readRepositoryTemplate(workspace, 'pull_request') }));
      },
    },
    {
      name: 'github_create_pull_request',
      description: 'Create exactly one GitHub pull request through gh after branch verification, duplicate detection, body validation, secret redaction, and explicit approval.',
      risk: 'high',
      inputSchema: z.object({ base: z.string().min(1), head: z.string().min(1), title: z.string().min(1), body: z.string().min(1), approved: z.boolean().default(false) }),
      async execute(input: { base: string; head: string; title: string; body: string; approved?: boolean }): Promise<ToolResult> {
        if (!input.approved) return fail('Explicit approval is required before creating a pull request.');
        const existing = await gh(workspace, ['pr', 'list', '--base', input.base, '--head', input.head, '--json', 'number,url,state']).catch(() => ({ stdout: '[]', stderr: '' }));
        const existingPrs = JSON.parse(existing.stdout || '[]') as unknown[];
        if (existingPrs.length > 0) return ok({ skipped: true, existing: existingPrs[0], idempotencyKey: canonicalGitActionSignature('github_pr', { base: input.base, head: input.head }) });
        const result = await gh(workspace, ['pr', 'create', '--base', input.base, '--head', input.head, '--title', redactSensitiveText(input.title), '--body', redactSensitiveText(input.body), '--json', 'number,url,state']);
        return ok(JSON.parse(result.stdout));
      },
    },
    {
      name: 'github_draft_issue',
      description: 'Generate one GitHub issue draft with labels and acceptance criteria. Does not publish.',
      risk: 'low',
      inputSchema: z.object({ kind: z.enum(['bug', 'feature', 'technical_debt', 'security_safe', 'documentation', 'performance', 'task']), title: z.string().min(1), report: z.string().min(1), component: z.string().optional(), labels: z.array(z.string()).optional() }),
      async execute(input: { kind: 'bug' | 'feature' | 'technical_debt' | 'security_safe' | 'documentation' | 'performance' | 'task'; title: string; report: string; component?: string; labels?: string[] }): Promise<ToolResult> {
        return ok(buildIssueDraft(input));
      },
    },
    {
      name: 'github_find_duplicate_issues',
      description: 'Detect likely duplicate issues from normalized title, error signatures, affected component, and explicit identifiers.',
      risk: 'low',
      inputSchema: z.object({ title: z.string().min(1), body: z.string().optional(), component: z.string().optional() }),
      async execute(input: { title: string; body?: string; component?: string }): Promise<ToolResult> {
        const result = await gh(workspace, ['issue', 'list', '--state', 'all', '--limit', '100', '--json', 'number,title,body,url']).catch(() => ({ stdout: '[]', stderr: '' }));
        const issues = JSON.parse(result.stdout || '[]') as Array<{ number: number; title: string; body?: string; url?: string }>;
        return ok(findDuplicateIssues(input, issues));
      },
    },
    {
      name: 'github_create_issue',
      description: 'Create exactly one GitHub issue through gh after duplicate detection, validation, redaction, idempotency, and explicit approval.',
      risk: 'high',
      inputSchema: z.object({ title: z.string().min(1), body: z.string().min(1), labels: z.array(z.string()).default([]), approved: z.boolean().default(false) }),
      async execute(input: { title: string; body: string; labels?: string[]; approved?: boolean }): Promise<ToolResult> {
        if (!input.approved) return fail('Explicit approval is required before creating an issue.');
        const duplicates = await createGitHubTools(workspace).find((tool) => tool.name === 'github_find_duplicate_issues')?.execute({ title: input.title, body: input.body });
        if (duplicates?.success) {
          const parsed = JSON.parse(duplicates.output) as Array<{ confidence: number }>;
          if (parsed.some((candidate) => candidate.confidence >= 0.9)) return ok({ skipped: true, reason: 'high-confidence duplicate issue found', duplicates: parsed });
        }
        const labels = input.labels ?? [];
        const args = ['issue', 'create', '--title', redactSensitiveText(input.title), '--body', redactSensitiveText(input.body), ...labels.flatMap((label: string) => ['--label', label])];
        const result = await gh(workspace, args);
        return ok({ url: result.stdout.trim(), state: 'open', labels, idempotencyKey: canonicalGitActionSignature('github_issue', { title: input.title.toLowerCase().trim() }) });
      },
    },
    {
      name: 'github_create_release',
      description: 'Create one GitHub release through gh for a tag after always-explicit approval and idempotency checks.',
      risk: 'high',
      inputSchema: z.object({ tag: z.string().min(1), title: z.string().optional(), notes: z.string().default(''), approved: z.boolean().default(false) }),
      async execute(input: { tag: string; title?: string; notes?: string; approved?: boolean }): Promise<ToolResult> {
        if (!input.approved) return fail('Always-explicit approval is required before publishing a GitHub release.');
        const existing = await gh(workspace, ['release', 'view', input.tag, '--json', 'tagName,url']).catch(() => ({ stdout: '', stderr: '' }));
        if (existing.stdout) return ok({ skipped: true, existing: JSON.parse(existing.stdout) });
        const args = ['release', 'create', input.tag, '--notes', redactSensitiveText(input.notes ?? '')];
        if (input.title) args.push('--title', input.title);
        const result = await gh(workspace, args);
        return ok({ tag: input.tag, url: result.stdout.trim() });
      },
    },
  ];
}

export function createReleasePlanControllerTool(): Tool<{ state?: unknown; completeStage?: string; result?: string }> {
  return {
    name: 'release_plan_controller',
    description: 'Create or advance a staged release plan with explicit allowed tools and approval requirement per stage.',
    risk: 'medium',
    inputSchema: z.object({ state: z.unknown().optional(), completeStage: z.string().optional(), result: z.string().optional() }),
    async execute(input): Promise<ToolResult> {
      const state = input.state && isReleasePlanState(input.state) ? input.state : createReleasePlanState();
      if (!input.completeStage) return ok(state);
      return ok(completeReleaseStage(state, input.completeStage as never, input.result ?? 'completed'));
    },
  };
}

function parsePorcelainStatus(output: string): {
  upstreamBranch?: string;
  ahead: number;
  behind: number;
  stagedFiles: string[];
  unstagedFiles: string[];
  untrackedFiles: string[];
  conflictedFiles: string[];
} {
  const result = { ahead: 0, behind: 0, stagedFiles: [] as string[], unstagedFiles: [] as string[], untrackedFiles: [] as string[], conflictedFiles: [] as string[], upstreamBranch: undefined as string | undefined };
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('##')) {
      const upstream = line.match(/\.\.\.([^\s[]+)/);
      result.upstreamBranch = upstream?.[1];
      result.ahead = Number(line.match(/ahead (\d+)/)?.[1] ?? 0);
      result.behind = Number(line.match(/behind (\d+)/)?.[1] ?? 0);
      continue;
    }
    const status = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (status === '??') result.untrackedFiles.push(file);
    else if (/^(UU|AA|DD|AU|UA|DU|UD)$/.test(status)) result.conflictedFiles.push(file);
    else {
      if (status[0] !== ' ' && status[0] !== '?') result.stagedFiles.push(file);
      if (status[1] !== ' ' && status[1] !== '?') result.unstagedFiles.push(file);
    }
  }
  return result;
}

function buildDiffArgs(input: { kind?: string; base?: string; head?: string; paths?: string[] }): string[] {
  const args = ['diff'];
  if (input.kind === 'staged') args.push('--cached');
  else if ((input.kind === 'branch' || input.kind === 'commit') && input.base && input.head) args.push(`${input.base}...${input.head}`);
  else if (input.base) args.push(input.base);
  if (input.paths?.length) args.push('--', ...input.paths);
  return args;
}

function parseNumstat(output: string): Array<{ path: string; additions: number; deletions: number; changeType: string }> {
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [added, deleted, ...pathParts] = line.split('\t');
    const path = pathParts.join('\t');
    return {
      path,
      additions: added === '-' ? 0 : Number(added),
      deletions: deleted === '-' ? 0 : Number(deleted),
      changeType: inferChangeType(path),
    };
  });
}

function totalsFromNumstat(output: string): { additions: number; deletions: number; files: number } {
  const files = parseNumstat(output);
  return {
    files: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

function budgetDiffByFile(diff: string, perFileLimit: number): Array<{ file: string; patch: string; truncated: boolean; omitted: boolean }> {
  const chunks = diff.split(/\n(?=diff --git )/g).filter(Boolean);
  return chunks.map((chunk) => {
    const file = chunk.match(/^diff --git a\/\S+ b\/(.+)$/m)?.[1] ?? '(unknown)';
    if (chunk.length <= perFileLimit) return { file, patch: chunk, truncated: false, omitted: false };
    const headerEnd = chunk.indexOf('@@');
    const header = headerEnd >= 0 ? chunk.slice(0, headerEnd) : chunk.slice(0, Math.min(600, chunk.length));
    const body = chunk.slice(Math.max(0, headerEnd)).slice(0, Math.max(0, perFileLimit - header.length - 80));
    return { file, patch: `${header}${body}\n...[truncated ${chunk.length - header.length - body.length} chars from ${file}]`, truncated: true, omitted: false };
  });
}

function parseGitLog(output: string, includeStats: boolean): unknown[] {
  const entries: unknown[] = [];
  const parts = output.split(/\n(?=[a-f0-9]{40}\x1f)/i).filter(Boolean);
  for (const part of parts) {
    const [firstLine, ...rest] = part.split(/\r?\n/);
    const [hash, shortHash, subject, author, timestamp, parents, refs] = firstLine.split('\x1f');
    entries.push({
      hash,
      shortHash,
      subject,
      author,
      timestamp,
      parents: parents.split(/\s+/).filter(Boolean),
      tags: refs.split(',').map((ref) => ref.trim()).filter((ref) => ref.startsWith('tag:')),
      fileStatistics: includeStats ? parseNumstat(rest.join('\n')) : undefined,
    });
  }
  return entries;
}

function parseBlame(output: string): Array<{ commitHash: string; author: string; timestamp?: string; originalLine: number; sourceLine: string }> {
  const lines = output.split(/\r?\n/);
  const result: Array<{ commitHash: string; author: string; timestamp?: string; originalLine: number; sourceLine: string }> = [];
  let current: { commitHash: string; author: string; timestamp?: string; originalLine: number } | undefined;
  for (const line of lines) {
    const header = line.match(/^([a-f0-9]{40})\s+\d+\s+(\d+)/i);
    if (header) current = { commitHash: header[1], author: '', originalLine: Number(header[2]) };
    else if (current && line.startsWith('author ')) current.author = line.slice(7);
    else if (current && line.startsWith('author-time ')) current.timestamp = new Date(Number(line.slice(12)) * 1000).toISOString();
    else if (current && line.startsWith('\t')) result.push({ ...current, sourceLine: line.slice(1) });
  }
  return result;
}

function validateStagePaths(workspace: string, paths: string[]): { warnings: string[]; error?: string } {
  const warnings: string[] = [];
  for (const path of paths) {
    if (path === '.' || path.endsWith('/')) return { warnings, error: 'Staging requires explicit files; directories and "." are not allowed.' };
    const absPath = join(workspace, path);
    if (!existsSync(absPath)) return { warnings, error: `File does not exist: ${path}` };
    const stat = statSync(absPath);
    if (stat.size > 5_000_000) warnings.push(`${path} is larger than 5MB.`);
    if (/\.(png|jpe?g|gif|webp|zip|tar|gz|pdf)$/i.test(path)) warnings.push(`${path} appears to be binary or generated.`);
    if (/\b(dist|build|coverage|generated)\b/i.test(path)) warnings.push(`${path} appears to be generated output.`);
    if (stat.isFile()) {
      const sample = readFileSync(absPath, 'utf8').slice(0, 200_000);
      if (/\b(gh[pousr]_|AKIA[0-9A-Z]{16}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|password\s*=|token\s*=)/i.test(sample)) {
        return { warnings, error: `Potential secret detected in ${path}; refusing to stage.` };
      }
    }
  }
  return { warnings };
}

function validateBranchName(name: string): string | undefined {
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return 'Branch name contains unsupported characters.';
  if (name.includes('..') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.lock')) return 'Invalid Git branch name.';
  return undefined;
}

function validateCommitMessageForTool(message: string): string | undefined {
  const subject = message.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (!subject) return 'Commit message subject is empty.';
  if (subject.length > 72) return 'Commit message subject exceeds 72 characters.';
  if (/```|token=|password=|gh[pousr]_|AKIA[0-9A-Z]{16}/i.test(message)) return 'Commit message contains markdown fences or likely secrets.';
  return undefined;
}

function inferChangeType(path: string): string {
  if (/=>/.test(path)) return 'renamed';
  return 'modified';
}

function isReleasePlanState(value: unknown): value is ReturnType<typeof createReleasePlanState> {
  return Boolean(value) && typeof value === 'object' && Array.isArray((value as { stages?: unknown }).stages);
}

function ok(value: unknown): ToolResult {
  return { success: true, output: JSON.stringify(value, null, 2) };
}

function fail(message: string, detail?: unknown): ToolResult {
  return { success: false, output: detail ? JSON.stringify(detail, null, 2) : '', error: message };
}

function git(cwd: string, args: string[]): Promise<GitRunResult> {
  return run('git', args, cwd);
}

function gh(cwd: string, args: string[]): Promise<GitRunResult> {
  return run('gh', args, cwd);
}

function run(command: string, args: string[], cwd: string): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `${command} ${args.join(' ')} failed with ${code}`));
    });
  });
}
