interface PendingPlanBannerProps {
  visible: boolean;
  onExecuteInAgent: () => void;
  onDismiss?: () => void;
}

export function PendingPlanBanner({
  visible,
  onExecuteInAgent,
  onDismiss,
}: PendingPlanBannerProps) {
  if (!visible) return null;

  return (
    <div className="pending-plan-banner" role="status">
      <div className="pending-plan-banner__text">
        <strong>Plan ready.</strong> Switch to Agent or execute to implement it.
      </div>
      <div className="pending-plan-banner__actions">
        <button type="button" className="btn" onClick={onExecuteInAgent}>
          Execute in Agent
        </button>
        {onDismiss ? (
          <button type="button" className="btn ghost" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}
