import { useEffect } from 'react';
import { useMachine } from '@xstate/react';
import { motion } from 'framer-motion';
import type { AgentActivityEntry, AgentLiveStatusView, SubagentStatusView } from '../../../vscode/webview/messages';
import { agentActivityMachine, type ActivityPhase } from '../state/agentActivityMachine';

interface AgentActivityPanelProps {
  entries: AgentActivityEntry[];
  loading: boolean;
  liveStatus?: AgentLiveStatusView | null;
  waitingForApproval?: boolean;
  subagents?: SubagentStatusView[];
}

const KIND_LABEL: Record<AgentActivityEntry['kind'], string> = {
  context: '$',
  read: '$',
  budget: '$',
  apply: '$',
  info: '$',
  approval: '$',
  error: '!',
  tool: '$',
  success: 'ok',
  skipped: '!',
};

function resolvePhase(loading: boolean, waitingForApproval: boolean, entries: AgentActivityEntry[]): ActivityPhase {
  if (loading) return 'working';
  if (waitingForApproval) return 'waiting';
  if (entries.some((entry) => entry.kind === 'success')) return 'complete';
  if (entries.some((entry) => entry.kind === 'error')) return 'error';
  return 'complete';
}

export function AgentActivityPanel({ entries, loading, liveStatus, waitingForApproval = false, subagents = [] }: AgentActivityPanelProps) {
  const [snapshot, send] = useMachine(agentActivityMachine);
  const phase = snapshot.value as ActivityPhase;
  const visible = entries.slice(-10);
  const latest = entries[entries.length - 1];
  const completionEntry = [...entries].reverse().find((entry) => entry.kind === 'success' || entry.kind === 'error');
  const statusLabel = loading
    ? liveStatus?.label ?? 'Working through steps'
    : waitingForApproval
      ? 'Waiting for your approval'
      : phase === 'error'
        ? 'Completed with issues'
        : 'All done';
  const progressLabel = liveStatus?.stepCurrent && liveStatus.stepTotal
    ? `${liveStatus.stepCurrent}/${liveStatus.stepTotal}`
    : undefined;
  const summaryDetail = !loading && !waitingForApproval && completionEntry?.detail
    ? completionEntry.detail
    : latest?.detail
      ? summarizeDetail(latest.detail)
      : liveStatus?.detail;
  const syntheticLine = loading && visible.length === 0
    ? liveStatus?.detail ?? 'Preparing response'
    : waitingForApproval && visible.length === 0
      ? 'Waiting for approval'
      : '';

  useEffect(() => {
    const next = resolvePhase(loading, waitingForApproval, entries);
    if (next === phase) return;
    if (next === 'working') send({ type: 'START' });
    else if (next === 'waiting') send({ type: 'WAIT' });
    else if (next === 'error') send({ type: 'FAIL' });
    else if (next === 'complete') send({ type: 'DONE' });
    else send({ type: 'RESET' });
  }, [loading, waitingForApproval, entries, phase, send]);

  if (entries.length === 0 && !loading && !waitingForApproval) return null;

  return (
    <motion.section
      className={`assistant-thinking assistant-thinking--${phase}`}
      aria-label="Agent activity"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="assistant-thinking__summary">
        <span className="assistant-thinking__summary-main">
          <span className="assistant-thinking__status-line">
            Brainstorming
          </span>
          <span className="assistant-thinking__latest">
            {[progressLabel ? `${statusLabel} · ${progressLabel}` : statusLabel, summaryDetail ? summarizeDetail(summaryDetail) : '']
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        {entries.length > 1 && <span className="assistant-thinking__count">{entries.length}</span>}
      </div>
      <ol className="assistant-thinking__list">
        {syntheticLine && (
          <motion.li
            className="assistant-thinking__item assistant-thinking__item--active"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.18 }}
          >
            <span className="assistant-thinking__kind">$</span>
            <span className="assistant-thinking__message">{summarizeDetail(syntheticLine)}</span>
          </motion.li>
        )}
        {visible.map((entry, index) => {
          const isLatest = index === visible.length - 1;
          return (
            <motion.li
              key={entry.id}
              className={`assistant-thinking__item assistant-thinking__item--${entry.kind} ${
                isLatest && loading ? 'assistant-thinking__item--active' : ''
              }`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18, delay: index * 0.03 }}
            >
              <span className="assistant-thinking__kind">{KIND_LABEL[entry.kind]}</span>
              <span className="assistant-thinking__message">{formatCommand(entry)}</span>
              {entry.detail && entry.kind !== 'success' && (
                <span className="assistant-thinking__detail">{summarizeDetail(entry.detail)}</span>
              )}
            </motion.li>
          );
        })}
      </ol>
      {subagents.length > 0 && (
        <ol className="assistant-thinking__subagents" aria-label="Subagent runs">
          {subagents.slice(-6).map((run) => (
            <li key={run.id} className={`assistant-thinking__subagent assistant-thinking__subagent--${run.status}`}>
              <span className="assistant-thinking__subagent-status">{formatSubagentStatus(run.status)}</span>
              <span className="assistant-thinking__subagent-body">
                <span className="assistant-thinking__subagent-title">
                  {run.type ?? 'subagent'}: {summarizeDetail(run.task)}
                </span>
                {(run.summary || run.error || run.focus) && (
                  <span className="assistant-thinking__subagent-detail">
                    {summarizeDetail(run.error ?? run.summary ?? run.focus ?? '')}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </motion.section>
  );
}

function formatSubagentStatus(status: SubagentStatusView['status']): string {
  switch (status) {
    case 'running':
      return 'run';
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    case 'queued':
      return 'queued';
  }
}

function summarizeDetail(detail: string): string {
  const firstLine = detail.split('\n').find(Boolean) ?? detail;
  return firstLine.length > 140 ? `${firstLine.slice(0, 140)}...` : firstLine;
}

function formatCommand(entry: AgentActivityEntry): string {
  const message = summarizeDetail(entry.message);
  const lower = message.toLowerCase();
  if (entry.kind === 'read' && !lower.startsWith('read ')) return `read ${message}`;
  if (entry.kind === 'context' && !lower.startsWith('context ')) return `context ${message}`;
  if (entry.kind === 'tool' && !lower.startsWith('run ')) return `run ${message}`;
  if (entry.kind === 'apply' && !lower.startsWith('edit ')) return `edit ${message}`;
  if (entry.kind === 'budget' && !lower.startsWith('budget ')) return `budget ${message}`;
  if (entry.kind === 'approval' && !lower.startsWith('approval ')) return `approval ${message}`;
  return message;
}
