import { basename, dirname, join, resolve } from 'path';

export function defaultWorktreePath(repoRoot: string, taskId: string): string {
  const root = resolve(repoRoot);
  const repo = basename(root).replace(/[^\w.-]+/g, '-');
  return join(dirname(root), `${repo}-mitii-${safeTaskId(taskId)}`);
}

export function branchForTask(taskId: string, title?: string): string {
  const slug = safeTaskId(title || taskId).slice(0, 48);
  const shortId = safeTaskId(taskId).slice(0, 8);
  return `mitii/task/${slug}-${shortId}`;
}

export function safeTaskId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
}
