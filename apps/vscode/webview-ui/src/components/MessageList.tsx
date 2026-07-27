import type { RefObject } from 'react';

import type {
  ActivityEventPayload,
  AgentUiMode,
  SuspensionPayload,
} from '../protocol';
import { AgentActivityPanel } from './AgentActivityPanel';
import { ApprovalCards } from './ApprovalCards';
import { MarkdownMessage } from './MarkdownMessage';

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
  bottomRef: RefObject<HTMLDivElement>;
}

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
  bottomRef,
}: MessageListProps) {
  if (turns.length === 0) {
    return (
      <div className="messages">
        <div className="empty-state">
          <h2>Ready when you are</h2>
          <p>
            Choose Ask, Plan, Agent, or Review from the mode dropdown. Use @ to
            pin files. Watch activity as the run progresses.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="messages" role="log" aria-live="polite">
      {turns.map((turn) => (
        <div key={turn.id} className="turn">
          {turn.role === 'user' ? (
            <>
              <div className="meta-row">
                <span>You</span>
                {turn.mode ? <span>{turn.mode}</span> : null}
              </div>
              <div className="bubble user">{turn.text}</div>
            </>
          ) : (
            <>
              <div className="meta-row">
                <span>Mitii</span>
                {turn.status ? <span>{turn.status}</span> : null}
                {turn.route ? <span>{turn.route}</span> : null}
              </div>
              <AgentActivityPanel
                events={turn.activity}
                open={activityOpen}
                onToggle={onToggleActivity}
                loading={Boolean(turn.streaming)}
              />
              {turn.text || turn.streaming ? (
                <div
                  className={`bubble assistant ${turn.streaming ? 'streaming' : ''}`}
                >
                  <MarkdownMessage
                    content={turn.text || (turn.streaming ? '' : '')}
                    streaming={turn.streaming}
                  />
                </div>
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
