/**
 * Dedicated Continue CTA — always rendered after file changes / answer body.
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
  const label = title?.trim()
    ? `Continue: ${title.trim()}`
    : 'Continue next slice';

  return (
    <section className="continue-slice-bar" aria-label="Continue next slice">
      <div className="continue-slice-bar__copy">
        <strong>Next slice ready</strong>
        <span>{label}</span>
      </div>
      <button
        type="button"
        className="continue-slice-bar__btn"
        disabled={busy}
        onClick={onContinue}
      >
        Continue
      </button>
    </section>
  );
}
