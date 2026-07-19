import { useEffect, useRef } from 'react';
import type { AgentActivityEntry, AgentLiveStatusView, ApprovalRequestView, ChatMessage } from '../../../vscode/webview/messages';
import { AGENT_NAME } from '../../../shared/brand';
import { MarkdownMessage } from './MarkdownMessage';
import { AgentActivityPanel } from './AgentActivityPanel';
import { ThinkingRow } from './ThinkingRow';
import { useStreamReveal } from '../hooks/useStreamReveal';
import type { ThunderMode } from '../../../features/ce/session/ThunderSession';

interface MessageListProps {
  messages: ChatMessage[];
  loading?: boolean;
  agentActivity?: AgentActivityEntry[];
  agentLiveStatus?: AgentLiveStatusView | null;
  approvals?: ApprovalRequestView[];
  showReasoning?: boolean;
  reasoningPreviewMaxChars?: number;
  mode?: ThunderMode;
}

function AssistantMessage({
  content,
  reasoningContent,
  streaming,
  showReasoning,
  reasoningPreviewMaxChars,
  mode,
  agentActivity = [],
  agentLiveStatus = null,
  loading = false,
  approvals = [],
}: {
  content: string;
  reasoningContent?: string;
  streaming?: boolean;
  showReasoning?: boolean;
  reasoningPreviewMaxChars?: number;
  mode: ThunderMode;
  agentActivity?: AgentActivityEntry[];
  agentLiveStatus?: AgentLiveStatusView | null;
  loading?: boolean;
  approvals?: ApprovalRequestView[];
}) {
  const revealed = useStreamReveal(content, Boolean(streaming));
  const label = mode === 'agent' ? 'Agent' : mode === 'plan' ? 'Plan' : 'Answer';
  const showActivity = loading || agentActivity.length > 0 || approvals.length > 0;

  return (
    <div className="assistant-turn">
      <div className="assistant-turn__header">
        <span>{label}</span>
        {(streaming || loading) && <span className="assistant-turn__status">Working</span>}
      </div>
      {!revealed.trim() && (streaming || loading) && (
        <p className="assistant-turn__pending">Preparing answer</p>
      )}
      {showActivity && (
        <AgentActivityPanel
          entries={agentActivity}
          loading={Boolean(loading)}
          liveStatus={agentLiveStatus}
          waitingForApproval={!loading && approvals.length > 0}
        />
      )}
      <ThinkingRow
        content={reasoningContent ?? ''}
        streaming={streaming}
        visible={showReasoning}
        maxChars={reasoningPreviewMaxChars}
      />
      {revealed.trim() ? (
        <MarkdownMessage content={revealed} streaming={streaming} />
      ) : null}
      {streaming && revealed.trim() && !revealed.includes('```') && (
        <span className="streaming-cursor streaming-cursor--pulse" aria-hidden="true">▋</span>
      )}
    </div>
  );
}

export function MessageList({
  messages,
  loading,
  agentActivity = [],
  agentLiveStatus = null,
  approvals = [],
  showReasoning = true,
  reasoningPreviewMaxChars = 8000,
  mode = 'ask',
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastUserIndex = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') return index;
    }
    return -1;
  })();
  const lastAssistantIndex = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant') return index;
    }
    return -1;
  })();
  const activeAssistantIndex = lastAssistantIndex > lastUserIndex ? lastAssistantIndex : -1;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading, agentActivity.length, agentLiveStatus?.label, agentLiveStatus?.stepCurrent, approvals.length]);

  if (messages.length === 0) {
    return (
      <div className="empty-chat">
        <p className="empty-title">{AGENT_NAME}</p>
        <p className="empty-subtitle">Ask about your codebase. Plan, review, or apply changes in Agent mode.</p>
      </div>
    );
  }

  return (
    <div className={`message-list message-list--mode-${mode}`} role="log" aria-live="polite">
      {messages.map((msg, index) => (
        <article key={msg.id} className={`message message--${msg.role}`}>
          <div className="message-content">
            {msg.role === 'assistant' ? (
              msg.content ? (
                <AssistantMessage
                  content={msg.content}
                  reasoningContent={msg.reasoningContent}
                  streaming={msg.streaming}
                  showReasoning={showReasoning}
                  reasoningPreviewMaxChars={reasoningPreviewMaxChars}
                  mode={mode}
                  agentActivity={index === activeAssistantIndex ? agentActivity : []}
                  agentLiveStatus={index === activeAssistantIndex ? agentLiveStatus : null}
                  loading={index === activeAssistantIndex ? Boolean(loading) : false}
                  approvals={index === activeAssistantIndex ? approvals : []}
                />
              ) : msg.reasoningContent ? (
                <AssistantMessage
                  content=""
                  reasoningContent={msg.reasoningContent}
                  streaming={msg.streaming}
                  showReasoning={showReasoning}
                  reasoningPreviewMaxChars={reasoningPreviewMaxChars}
                  mode={mode}
                  agentActivity={index === activeAssistantIndex ? agentActivity : []}
                  agentLiveStatus={index === activeAssistantIndex ? agentLiveStatus : null}
                  loading={index === activeAssistantIndex ? Boolean(loading) : false}
                  approvals={index === activeAssistantIndex ? approvals : []}
                />
              ) : msg.streaming ? (
                <AssistantMessage
                  content=""
                  streaming={msg.streaming}
                  showReasoning={showReasoning}
                  reasoningPreviewMaxChars={reasoningPreviewMaxChars}
                  mode={mode}
                  agentActivity={index === activeAssistantIndex ? agentActivity : []}
                  agentLiveStatus={index === activeAssistantIndex ? agentLiveStatus : null}
                  loading={index === activeAssistantIndex ? Boolean(loading) : false}
                  approvals={index === activeAssistantIndex ? approvals : []}
                />
              ) : (
                <div className="assistant-turn">
                  <div className="assistant-turn__header">
                    <span>{mode === 'agent' ? 'Agent' : mode === 'plan' ? 'Plan' : 'Answer'}</span>
                  </div>
                  <p className="message-working message-working--muted">No response text</p>
                </div>
              )
            ) : (
              msg.content
            )}
          </div>
        </article>
      ))}
      {activeAssistantIndex === -1 && (loading || agentActivity.length > 0 || approvals.length > 0) && (
        <article className="message message--assistant">
          <div className="message-content">
            <AssistantMessage
              content=""
              streaming={Boolean(loading)}
              showReasoning={showReasoning}
              reasoningPreviewMaxChars={reasoningPreviewMaxChars}
              mode={mode}
              agentActivity={agentActivity}
              agentLiveStatus={agentLiveStatus}
              loading={Boolean(loading)}
              approvals={approvals}
            />
          </div>
        </article>
      )}
      <div ref={bottomRef} className="message-list__anchor" />
    </div>
  );
}
