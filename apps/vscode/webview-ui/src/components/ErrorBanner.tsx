interface ErrorBannerProps {
  error: string | null;
  onDismiss: () => void;
  onSettings?: () => void;
}

export function ErrorBanner({ error, onDismiss, onSettings }: ErrorBannerProps) {
  if (!error) return null;

  return (
    <div className="error-banner" role="alert">
      <span className="error-banner__text">{error}</span>
      <div className="error-banner__actions">
        {onSettings ? (
          <button type="button" className="btn ghost" onClick={onSettings}>
            Settings
          </button>
        ) : null}
        <button
          type="button"
          className="error-banner__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss error"
        >
          ×
        </button>
      </div>
    </div>
  );
}
