import type { ReactNode } from 'react';

export interface PendingPlanBannerProps {
  visible: boolean;
  onExecuteInAgent: () => void;
  onDismiss?: () => void;
  /** Disables both actions while a run is starting. */
  busy?: boolean;
  /** Sentence shown after the bold "Plan ready." lead. */
  description?: ReactNode;
  /** Primary CTA label (default Build). */
  primaryLabel?: string;
}

const DEFAULT_DESCRIPTION = 'Build to implement it.';

/** Strip shown when a plan is waiting for hand-off to Agent mode. */
export function PendingPlanBanner({
  visible,
  onExecuteInAgent,
  onDismiss,
  busy,
  description = DEFAULT_DESCRIPTION,
  primaryLabel = 'Build',
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
          {primaryLabel}
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
