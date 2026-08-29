import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskList } from '@mitii/sdk';
import { serializeTaskListMarkdown } from '@mitii/sdk';

import { mitiiTasksDir } from './mitiiWorkspace.js';

export interface SaveTaskListOptions {
  workspaceRoot: string;
  taskList: TaskList;
  threadId?: string;
}

export interface SaveTaskListResult {
  absolutePath: string;
  relativePath: string;
}

/**
 * Persist the live task list as markdown for inspection and user edits.
 */
export function saveTaskListToWorkspace(
  options: SaveTaskListOptions,
): SaveTaskListResult {
  const dir = mitiiTasksDir(options.workspaceRoot);
  mkdirSync(dir, { recursive: true });
  const fileName = `${sanitizeId(options.threadId ?? 'session')}.md`;
  const absolutePath = join(dir, fileName);
  writeFileSync(absolutePath, serializeTaskListMarkdown(options.taskList), 'utf8');
  return {
    absolutePath,
    relativePath: `.mitii/tasks/${fileName}`,
  };
}

function sanitizeId(value: string): string {
  const slug = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, 80) || 'session';
}
