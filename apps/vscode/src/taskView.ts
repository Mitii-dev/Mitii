import type { TaskItem, TaskList } from '@mitii/sdk';

import type { TaskItemView, TaskListView } from './protocol.js';

export function taskViewFromList(
  list: TaskList | undefined | null,
  options: { savedTaskPath?: string } = {},
): TaskListView | null {
  if (!list || list.items.length === 0) return null;
  const items: TaskItemView[] = list.items.map((item: TaskItem) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    ...(item.detail ? { detail: item.detail } : {}),
  }));
  return {
    source: list.source,
    ...(list.title ? { title: list.title } : {}),
    items,
    ...(options.savedTaskPath ? { savedTaskPath: options.savedTaskPath } : {}),
  };
}
