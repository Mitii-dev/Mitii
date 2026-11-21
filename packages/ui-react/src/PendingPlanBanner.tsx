import type { ReactNode } from 'react';

export interface PendingPlanBannerProps {
  visible: boolean;
  onExecuteInAgent: () => void;
  onDismiss?: () => void;
  /** Disables both actions while a run is starting. */
  busy?: boolean;
  /** Sentence shown after the bold "Plan ready." lead. */
  description?: ReactNode;
}

const DEFAULT_DESCRIPTION = 'Switch to Agent or execute to implement it.';

/** Strip shown when a plan is waiting for hand-off to Agent mode. */
export function PendingPlanBanner({
  visible,
  onExecuteInAgent,
  onDismiss,
  busy,
  description = DEFAULT_DESCRIPTION,
}: PendingPlanBannerProps) {
  if (!visible) return null;

  return (
    <div className="pending-plan-banner" role="status">
      <div className="pending-plan-banner__text">
        <strong>Plan ready.</strong> {description}
      </div>
      <div className="pending-plan-banner__actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={onExecuteInAgent}
        >
          Execute in Agent
        </button>
        {onDismiss ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={onDismiss}
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}
