/** Chat view container (topbar, feed, approval card, composer). */

import { type CSSProperties } from 'react';
import { IconPlus } from '../shell/ActivityIcons.js';
import { ApprovalCard } from './ApprovalCard.js';
import type { AppModel } from '../app/useAppModel.js';
import { ChatFeed } from './ChatFeed.js';
import { ChatComposer } from './ChatComposer.js';

export function ChatPanel({ m }: { m: AppModel }) {
  const {
    inCodeMode,
    accent,
    busy,
    mode,
    onNewChat,
    error,
    suspension,
    onApproveSuspension,
    onDenySuspension,
    onClarifySuspension,
    onContinueSuspension,
    onStopSuspension,
  } = m;

  return (
    <div
      className={`chat-view${inCodeMode ? ' chat-view--code' : ''}`}
      style={{ '--composer-mode-color': accent } as CSSProperties}
    >
      {inCodeMode ? (
        <div className="chat-topbar">
          <div className="chat-topbar__left">
            <span className="chat-topbar__title">Chat</span>
          </div>
          <button
            type="button"
            className="chat-topbar__new"
            disabled={busy}
            title={busy ? 'Agent is running' : 'New chat'}
            aria-label={busy ? 'Agent is running' : 'New chat'}
            onClick={() => void onNewChat()}
          >
            <IconPlus size={16} />
          </button>
        </div>
      ) : null}
      {error ? <div className="alert">{error}</div> : null}

      <ChatFeed m={m} />

      {suspension ? (
        <ApprovalCard
          suspension={suspension}
          busy={busy}
          mode={mode}
          onApprove={onApproveSuspension}
          onDeny={onDenySuspension}
          onClarify={onClarifySuspension}
          onContinue={onContinueSuspension}
          onStop={onStopSuspension}
        />
      ) : null}

      <ChatComposer m={m} />
    </div>
  );
}
