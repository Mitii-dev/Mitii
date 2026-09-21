import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ActivityBarButtonProps = {
  label: string;
  active?: boolean;
  badge?: ReactNode;
  children: ReactNode;
} & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'title' | 'aria-label' | 'type'
>;

/** Activity-bar icon control with a mastered hover tooltip. */
export function ActivityBarButton(props: ActivityBarButtonProps) {
  const { label, active, badge, children, className, ...rest } = props;
  const classes = [active ? 'is-active' : undefined, className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes || undefined}
      aria-label={label}
      {...rest}
    >
      {children}
      {badge}
      <span className="activity-tooltip" aria-hidden="true">
        <span className="activity-tooltip__label">{label}</span>
      </span>
    </button>
  );
}
