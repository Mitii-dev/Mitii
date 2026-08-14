import type { RefObject } from 'react';

import type {
  ActivityEventPayload,
  AgentUiMode,
  RunFileChangesView,
  SuspensionPayload,
} from '../protocol';
import {
  AgentActivityPanel,
  AgentThinkingPanel,
} from './AgentActivityPanel';
import { ApprovalCards } from './ApprovalCards';
import { FileChangesCard } from './FileChangesCard';
import { MarkdownMessage } from './MarkdownMessage';
import LOGO from '../../../media/Mitii.png';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  mode?: AgentUiMode;
  streaming?: boolean;
  activity: ActivityEventPayload[];
  status?: string;
  route?: string | null;
  suspension?: SuspensionPayload;
  fileChanges?: RunFileChangesView;
}

interface MessageListProps {
  turns: ChatTurn[];
  activityOpen: boolean;
  onToggleActivity: () => void;
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
  activityOpen,
  onToggleActivity,
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
              <div className="meta-row">
                <span>Request</span>
                {turn.mode ? (
                  <span className="meta-pill">{MODE_LABELS[turn.mode]}</span>
                ) : null}
              </div>
              <div className="bubble user">{turn.text}</div>
            </>
          ) : (
            <>
              <div className="meta-row">
                <span>Mitii</span>
                {turn.status ? (
                  <span className="meta-pill">{turn.status}</span>
                ) : null}
                {turn.route ? <span className="meta-pill">{turn.route}</span> : null}
              </div>
              {turn.text || turn.streaming ? (
                <div
                  className={`bubble assistant ${turn.streaming ? 'streaming' : ''}`}
                >
                  <MarkdownMessage
                    content={turn.text || (turn.streaming ? '' : '')}
                    streaming={turn.streaming}
                    onOpenFile={onOpenFile}
                  />
                </div>
              ) : null}
              {turn.streaming || turn.suspension ? (
                <>
                  <AgentActivityPanel
                    events={turn.activity}
                    open={activityOpen}
                    onToggle={onToggleActivity}
                  />
                  <AgentThinkingPanel events={turn.activity} />
                </>
              ) : null}
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
