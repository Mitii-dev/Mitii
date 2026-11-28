/**
 * Subtle Continue control — forces Agent next-slice (not typed chat).
 */

export interface ContinueSliceBarProps {
  title?: string;
  busy?: boolean;
  onContinue: () => void;
}

export function ContinueSliceBar({
  title,
  busy = false,
  onContinue,
}: ContinueSliceBarProps) {
  const hint = title?.trim() || 'Continue next slice';

  return (
    <div className="continue-slice">
      <button
        type="button"
        className="continue-slice__btn"
        disabled={busy}
        title={hint}
        aria-label={hint}
        onClick={onContinue}
      >
        Continue
      </button>
    </div>
  );
}
