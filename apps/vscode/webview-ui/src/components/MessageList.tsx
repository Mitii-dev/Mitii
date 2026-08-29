import type { RefObject } from 'react';

import type {
  ActivityEventPayload,
  AgentUiMode,
  RunFileChangesView,
  SuspensionPayload,
} from '../protocol';
import { AgentTimeline } from './AgentTimeline';
import { ApprovalCards } from './ApprovalCards';
import { FileChangesCard } from './FileChangesCard';
import { derivePhase, LiveStatus } from './LiveStatus';
import { MarkdownMessage } from './MarkdownMessage';
import LOGO from '../../../media/Mitii.png';

export type TurnSegment =
  | { id: string; kind: 'text'; text: string; at: number }
  | { id: string; kind: 'activity'; event: ActivityEventPayload };

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  segments: TurnSegment[];
  warnings?: string[];
  mode?: AgentUiMode;
  streaming?: boolean;
  status?: string;
  route?: string | null;
  suspension?: SuspensionPayload;
  fileChanges?: RunFileChangesView;
}

type SegmentGroup =
  | { type: 'text'; id: string; text: string }
  | {
      type: 'activity';
      id: string;
      events: ActivityEventPayload[];
      endAt?: number;
    };

function groupSegments(segments: TurnSegment[]): SegmentGroup[] {
  const groups: SegmentGroup[] = [];
  for (const seg of segments) {
    if (seg.kind === 'text') {
      const last = groups[groups.length - 1];
      if (last?.type === 'activity' && last.endAt === undefined) {
        last.endAt = seg.at;
      }
      groups.push({ type: 'text', id: seg.id, text: seg.text });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last?.type === 'activity') {
      last.events.push(seg.event);
    } else {
      groups.push({ type: 'activity', id: seg.id, events: [seg.event] });
    }
  }
  return groups;
}

interface MessageListProps {
  turns: ChatTurn[];
  clarifyText: string;
  onClarifyChange: (value: string) => void;
  onResumeClarify: (runId: string, answer: string) => void;
  onResumeStop: (runId: string) => void;
  onApprove: (runId: string, approvalId?: string) => void;
  onDeny: (runId: string, approvalId?: string) => void;
  onShowInlineDiff: (approvalId: string) => void;
  onOpenFile: (path: string, line?: number, column?: number) => void;
  onUndoFileChanges: (runId: string) => void;
  onReviewFileChange: (runId: string, path: string) => void;
  onReviewAllFileChanges: (changes: RunFileChangesView) => void;
  onDismissFileChanges: (runId: string) => void;
  containerRef: RefObject<HTMLDivElement>;
  onScroll: () => void;
  bottomRef: RefObject<HTMLDivElement>;
}

const MODE_LABELS: Record<AgentUiMode, string> = {
  ask: 'Ask mode',
  plan: 'Plan mode',
  agent: 'Agent mode',
  review: 'Review mode',
};

export function MessageList({
  turns,
  clarifyText,
  onClarifyChange,
  onResumeClarify,
  onResumeStop,
  onApprove,
  onDeny,
  onShowInlineDiff,
  onOpenFile,
  onUndoFileChanges,
  onReviewFileChange,
  onReviewAllFileChanges,
  onDismissFileChanges,
  containerRef,
  onScroll,
  bottomRef,
}: MessageListProps) {
  if (turns.length === 0) {
    return (
      <div
        className="messages messages--empty"
        ref={containerRef}
        onScroll={onScroll}
      >
        <div className="empty-state">
          <img src={LOGO} alt="Mitii Logo" />
          <h2>Ready when you are</h2>
          <p>Workspace context is ready. Start with the outcome you want.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="messages"
      ref={containerRef}
      onScroll={onScroll}
      role="log"
      aria-live="polite"
    >
      {turns.map((turn) => (
        <div
          key={turn.id}
          className={`turn turn--${turn.role}${turn.suspension ? ' turn--suspended' : ''}`}
        >
          {turn.role === 'user' ? (
            <>
              {turn.mode ? (
                <div className="meta-row">
                  <span className="meta-pill">{MODE_LABELS[turn.mode]}</span>
                </div>
              ) : null}
              <div className="bubble user">{turn.text}</div>
            </>
          ) : (
            <>
              {turn.status || turn.route ? (
                <div className="meta-row">
                  {turn.status ? (
                    <span className="meta-pill">{turn.status}</span>
                  ) : null}
                  {turn.route ? (
                    <span className="meta-pill">{turn.route}</span>
                  ) : null}
                </div>
              ) : null}
              {turn.warnings?.length ? (
                <div className="run-warning-banner" role="alert">
                  <strong>Warning</strong>
                  <ul className="run-warning-banner__list">
                    {turn.warnings.map((warning, index) => (
                      <li key={`${turn.id}-warning-${index}`}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(() => {
                const groups = groupSegments(turn.segments);
                const lastIndex = groups.length - 1;
                const lastGroup = groups[lastIndex];
                const showLiveStatus =
                  Boolean(turn.streaming) &&
                  (!lastGroup ||
                    (lastGroup.type === 'activity' &&
                      lastGroup.events[lastGroup.events.length - 1]?.kind !==
                        'thinking'));
                const lastEvent =
                  lastGroup?.type === 'activity'
                    ? lastGroup.events[lastGroup.events.length - 1]
                    : undefined;
                return (
                  <>
                    {groups.map((group, i) => {
                      const isLastGroup = i === lastIndex;
                      const groupStreaming = isLastGroup && Boolean(turn.streaming);
                      return group.type === 'text' ? (
                        <div
                          key={group.id}
                          className={`bubble assistant${groupStreaming ? ' streaming' : ''}`}
                        >
                          <MarkdownMessage
                            content={group.text}
                            streaming={groupStreaming}
                            onOpenFile={onOpenFile}
                          />
                        </div>
                      ) : (
                        <AgentTimeline
                          key={group.id}
                          events={group.events}
                          streaming={groupStreaming}
                          endAt={group.endAt}
                        />
                      );
                    })}
                    {showLiveStatus ? (
                      <LiveStatus phase={derivePhase(lastEvent)} />
                    ) : null}
                  </>
                );
              })()}
              {turn.fileChanges ? (
                <FileChangesCard
                  changes={turn.fileChanges}
                  onOpenFile={(path) => onOpenFile(path)}
                  onReviewFile={(path) =>
                    onReviewFileChange(turn.fileChanges!.runId, path)
                  }
                  onUndo={() => onUndoFileChanges(turn.fileChanges!.runId)}
                  onReviewAll={() =>
                    onReviewAllFileChanges(turn.fileChanges!)
                  }
                  onDismiss={() =>
                    onDismissFileChanges(turn.fileChanges!.runId)
                  }
                />
              ) : null}
              {turn.suspension ? (
                <ApprovalCards
                  suspension={turn.suspension}
                  clarifyText={clarifyText}
                  onClarifyChange={onClarifyChange}
                  onSubmitClarify={(answer) =>
                    onResumeClarify(turn.suspension!.runId, answer)
                  }
                  onStop={() => onResumeStop(turn.suspension!.runId)}
                  onApprove={() =>
                    onApprove(
                      turn.suspension!.runId,
                      turn.suspension!.approval?.approvalId,
                    )
                  }
                  onDeny={() =>
                    onDeny(
                      turn.suspension!.runId,
                      turn.suspension!.approval?.approvalId,
                    )
                  }
                  onShowInlineDiff={onShowInlineDiff}
                />
              ) : null}
            </>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
