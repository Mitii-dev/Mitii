/** Source control API. */

import {
  authHeaders,
} from './http.js';

export async function fetchGitStatus(options: {
  baseUrl: string;
  token?: string;
}): Promise<import('../../shared/git/workingTree.js').GitWorkingTreeSnapshot> {
  const res = await fetch(`${options.baseUrl}/v1/git/status`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`git_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchGitStatus>>;
}

export async function fetchGitDiff(options: {
  baseUrl: string;
  token?: string;
  path: string;
}): Promise<{ path: string; diff: string }> {
  const res = await fetch(
    `${options.baseUrl}/v1/git/diff?path=${encodeURIComponent(options.path)}`,
    { headers: authHeaders(options.token) },
  );
  if (!res.ok) throw new Error(`git_diff_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchGitDiff>>;
}

export async function fetchGitBranches(options: {
  baseUrl: string;
  token?: string;
}): Promise<import('../../shared/git/workingTree.js').GitBranchListSnapshot> {
  const res = await fetch(`${options.baseUrl}/v1/git/branches`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`git_branches_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchGitBranches>>;
}

async function postGitMutation(
  options: {
    baseUrl: string;
    token?: string;
    path: string;
    body?: Record<string, unknown>;
  },
): Promise<import('../../shared/git/workingTree.js').GitMutationResult> {
  const res = await fetch(`${options.baseUrl}${options.path}`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify(options.body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`git_mutation_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<
    ReturnType<typeof postGitMutation>
  >;
}

export async function gitStageFiles(options: {
  baseUrl: string;
  token?: string;
  paths?: string[];
}): Promise<import('../../shared/git/workingTree.js').GitMutationResult> {
  return postGitMutation({
    ...options,
    path: '/v1/git/stage',
    body: { paths: options.paths },
  });
}

export async function gitUnstageFiles(options: {
  baseUrl: string;
  token?: string;
  paths?: string[];
}): Promise<import('../../shared/git/workingTree.js').GitMutationResult> {
  return postGitMutation({
    ...options,
    path: '/v1/git/unstage',
    body: { paths: options.paths },
  });
}

export async function gitDiscardFiles(options: {
  baseUrl: string;
  token?: string;
  paths: string[];
  includeUntracked?: boolean;
}): Promise<import('../../shared/git/workingTree.js').GitMutationResult> {
  return postGitMutation({
    ...options,
    path: '/v1/git/discard',
    body: {
      paths: options.paths,
      includeUntracked: options.includeUntracked === true,
    },
  });
}

export async function gitCommitChanges(options: {
  baseUrl: string;
  token?: string;
  message: string;
  all?: boolean;
}): Promise<import('../../shared/git/workingTree.js').GitMutationResult> {
  return postGitMutation({
    ...options,
    path: '/v1/git/commit',
    body: { message: options.message, all: options.all === true },
  });
}

export async function gitStashFiles(options: {
  baseUrl: string;
  token?: string;
  paths: string[];
  includeUntracked?: boolean;
  message?: string;
}): Promise<import('../../shared/git/workingTree.js').GitMutationResult> {
  return postGitMutation({
    ...options,
    path: '/v1/git/stash',
    body: {
      paths: options.paths,
      includeUntracked: options.includeUntracked === true,
      ...(options.message ? { message: options.message } : {}),
    },
  });
}

export async function gitCheckoutBranch(options: {
  baseUrl: string;
  token?: string;
  branch: string;
  create?: boolean;
}): Promise<import('../../shared/git/workingTree.js').GitMutationResult> {
  return postGitMutation({
    ...options,
    path: '/v1/git/checkout',
    body: { branch: options.branch, create: options.create === true },
  });
}

export async function fetchFileChanges(options: {
  baseUrl: string;
  token?: string;
  paths: string[];
}): Promise<import('../../shared/fileChanges.js').DesktopFileChanges> {
  const res = await fetch(`${options.baseUrl}/v1/git/file-changes`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ paths: options.paths }),
  });
  if (!res.ok) throw new Error(`file_changes_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchFileChanges>>;
}
