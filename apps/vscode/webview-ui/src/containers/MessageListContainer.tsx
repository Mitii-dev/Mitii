import { type AppApi } from '../app/appApi';
import { postToHost } from '../bridge';
import { MessageList } from '../components/MessageList';

export function MessageListContainer({ api }: { api: AppApi }) {
  const {
    bottomRef,
    clarifyText,
    dismissFileChanges,
    markSuspensionResumed,
    messagesRef,
    onMessagesScroll,
    openFile,
    reviewAllFileChanges,
    reviewFileChange,
    setClarifyText,
    turns,
    ui,
    undoFileChanges,
  } = api;

  return (
    <MessageList
      turns={turns}
      clarifyText={clarifyText}
      onClarifyChange={setClarifyText}
      onResumeClarify={(runId, answer) => {
        postToHost({
          type: 'resume',
          runId,
          clarificationAnswer: answer,
        });
        markSuspensionResumed(runId);
        setClarifyText('');
      }}
      onResumeStop={(runId) => {
        const turn = turns.find((t) => t.suspension?.runId === runId);
        if (turn?.suspension?.kind === 'continue_required') {
          postToHost({
            type: 'resume',
            runId,
            continueDecision: { decision: 'stop' },
          });
          markSuspensionResumed(runId);
          setClarifyText('');
          return;
        }
        postToHost({ type: 'resume', runId });
      }}
      onResumeContinue={(runId, guidance) => {
        postToHost({
          type: 'resume',
          runId,
          continueDecision: {
            decision: 'continue',
            ...(guidance ? { guidance } : {}),
          },
        });
        markSuspensionResumed(runId);
        setClarifyText('');
      }}
      onApprove={(runId, approvalId) => {
        const turn = turns.find((t) => t.suspension?.runId === runId);
        if (turn?.suspension?.kind === 'plan_approval_required') {
          postToHost({
            type: 'resume',
            runId,
            planDecision: { decision: 'approved' },
          });
          markSuspensionResumed(runId);
          return;
        }
        if (turn?.suspension?.kind === 'grant_expansion_required') {
          const expansionId =
            turn.suspension.grantExpansion?.expansionId;
          if (!expansionId) return;
          postToHost({
            type: 'resume',
            runId,
            grantExpansion: {
              expansionId,
              decision: 'approved',
            },
          });
          markSuspensionResumed(runId);
          return;
        }
        if (turn?.suspension?.kind === 'continue_required') {
          postToHost({
            type: 'resume',
            runId,
            continueDecision: { decision: 'continue' },
          });
          markSuspensionResumed(runId);
          setClarifyText('');
          return;
        }
        if (!approvalId) return;
        postToHost({
          type: 'resume',
          runId,
          approval: { approvalId, decision: 'approved' },
        });
        markSuspensionResumed(runId);
      }}
      onDeny={(runId, approvalId) => {
        const turn = turns.find((t) => t.suspension?.runId === runId);
        if (turn?.suspension?.kind === 'plan_approval_required') {
          postToHost({
            type: 'resume',
            runId,
            planDecision: { decision: 'rejected' },
          });
          markSuspensionResumed(runId);
          return;
        }
        if (turn?.suspension?.kind === 'grant_expansion_required') {
          const expansionId =
            turn.suspension.grantExpansion?.expansionId;
          if (!expansionId) return;
          postToHost({
            type: 'resume',
            runId,
            grantExpansion: {
              expansionId,
              decision: 'denied',
            },
          });
          markSuspensionResumed(runId);
          return;
        }
        if (turn?.suspension?.kind === 'continue_required') {
          postToHost({
            type: 'resume',
            runId,
            continueDecision: { decision: 'stop' },
          });
          markSuspensionResumed(runId);
          setClarifyText('');
          return;
        }
        if (!approvalId) return;
        postToHost({
          type: 'resume',
          runId,
          approval: { approvalId, decision: 'denied' },
        });
        markSuspensionResumed(runId);
      }}
      onShowInlineDiff={(approvalId) =>
        postToHost({ type: 'showInlineDiff', approvalId })
      }
      onOpenFile={openFile}
      onUndoFileChanges={undoFileChanges}
      onReviewFileChange={reviewFileChange}
      onReviewAllFileChanges={reviewAllFileChanges}
      onDismissFileChanges={dismissFileChanges}
      showWarnings={ui.developerEnabled === true}
      containerRef={messagesRef}
      onScroll={onMessagesScroll}
      bottomRef={bottomRef}
    />
  );
}
