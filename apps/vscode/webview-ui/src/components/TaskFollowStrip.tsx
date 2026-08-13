import type { CSSProperties } from 'react';
import { useState } from 'react';

import { modeColor } from '../modeColors';
import type { TaskItemView, TaskListView } from '../protocol';

interface TaskFollowStripProps {
  taskList: TaskListView | null;
  running?: boolean;
  onOpenTaskFile?: (path: string) => void;
}

const STATUS_LABELS: Record<TaskItemView['status'], string> = {
  active: 'Running',
  done: 'Done',
  pending: 'Queued',
  skipped: 'Skipped',
  blocked: 'Blocked',
};

function currentTask(taskList: TaskListView | null) {
  const items = taskList?.items ?? [];
  if (items.length === 0) return null;
  const activeIndex = items.findIndex((item) => item.status === 'active');
  if (activeIndex >= 0) {
    return { item: items[activeIndex]!, index: activeIndex, complete: false };
  }
  const nextIndex = items.findIndex(
    (item) => item.status !== 'done' && item.status !== 'skipped',
  );
  if (nextIndex >= 0) {
    return { item: items[nextIndex]!, index: nextIndex, complete: false };
  }
  return {
    item: items[items.length - 1]!,
    index: items.length - 1,
    complete: items.every((item) => item.status === 'done'),
  };
}

export function TaskFollowStrip({
  taskList,
  running = false,
  onOpenTaskFile,
}: TaskFollowStripProps) {
  const [expanded, setExpanded] = useState(false);
  const current = currentTask(taskList);
  if (!taskList || taskList.items.length === 0) return null;

  const total = taskList.items.length;
  const completed = taskList.items.filter((item) => item.status === 'done').length;
  const allDone = current?.complete === true;
  const statusText = allDone ? 'Done' : running ? 'Running' : 'Ready';
  const headingText = allDone ? 'Tasks complete' : 'Tasks';
  const currentIsRunning =
    current &&
    !current.complete &&
    (current.item.status === 'active' ||
      (running &&
        current.item.status !== 'done' &&
        current.item.status !== 'skipped'));
  const style = {
    '--plan-follow-accent': modeColor('agent'),
  } as CSSProperties;

  return (
    <section
      className="plan-follow task-follow"
      aria-label="Current task"
      style={style}
    >
      <div className="plan-follow__top">
        <div className="plan-follow__heading">
          <span className="plan-follow__eyebrow">{headingText}</span>
          <span className="plan-follow__progress">
            {completed}/{total} complete
          </span>
        </div>
        <div className="plan-follow__actions">
          <button
            type="button"
            className="plan-follow__toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          {taskList.savedTaskPath && onOpenTaskFile ? (
            <button
              type="button"
              className="plan-follow__location"
              onClick={() => onOpenTaskFile(taskList.savedTaskPath!)}
              title={`Open ${taskList.savedTaskPath}`}
            >
              Location
            </button>
          ) : null}
        </div>
      </div>
      <div className="plan-follow__step">
        {current ? (
          <span className="plan-follow__count">
            Task {current.index + 1} of {total}
          </span>
        ) : (
          <span className="plan-follow__count">
            {total} task{total === 1 ? '' : 's'}
          </span>
        )}
        {current ? (
          <span
            className={`task-follow__status task-follow__status--${current.item.status}`}
            role="img"
            aria-label={STATUS_LABELS[current.item.status]}
          />
        ) : null}
        <span className="plan-follow__title">
          {current ? current.item.title : taskList.title ?? 'Tasks'}
        </span>
        <span
          className={`plan-follow__state plan-follow__state--${allDone ? 'done' : 'following'}`}
        >
          {statusText}
        </span>
        {running && !allDone ? (
          <span className="plan-follow__loader" aria-hidden />
        ) : null}
      </div>
      {expanded ? (
        <ol className="plan-follow__steps">
          {taskList.items.map((item) => (
            <li
              key={item.id}
              className={`plan-follow__steps-item plan-follow__steps-item--${
                currentIsRunning && current?.item.id === item.id
                  ? 'active'
                  : item.status
              }`}
              aria-current={
                currentIsRunning && current?.item.id === item.id
                  ? 'step'
                  : undefined
              }
            >
              <span
                className={`task-follow__status task-follow__status--${item.status}`}
                role="img"
                aria-label={STATUS_LABELS[item.status]}
              />
              <span className="plan-follow__steps-title">{item.title}</span>
              <span className="plan-follow__steps-status">
                {currentIsRunning && current?.item.id === item.id
                  ? 'Running'
                  : STATUS_LABELS[item.status]}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
