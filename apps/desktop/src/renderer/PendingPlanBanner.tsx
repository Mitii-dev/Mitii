interface PendingPlanBannerProps {
  visible: boolean;
  onExecuteInAgent: () => void;
  onDismiss?: () => void;
  busy?: boolean;
}

export function PendingPlanBanner({
  visible,
  onExecuteInAgent,
  onDismiss,
  busy,
}: PendingPlanBannerProps) {
  if (!visible) return null;

  return (
    <div className="pending-plan-banner" role="status">
      <div className="pending-plan-banner__text">
        <strong>Plan ready.</strong> Switch to Agent or start building to
        implement it.
      </div>
      <div className="pending-plan-banner__actions">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={onExecuteInAgent}
        >
          Start building
        </button>
        {onDismiss ? (
          <button
            type="button"
            className="btn-ghost"
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
