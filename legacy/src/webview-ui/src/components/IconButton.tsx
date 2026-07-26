import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  variant?: 'default' | 'ghost' | 'accent';
  children: ReactNode;
}

export function IconButton({
  label,
  active = false,
  variant = 'default',
  className = '',
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn--${variant}${active ? ' icon-btn--active' : ''} has-tooltip ${className}`.trim()}
      aria-label={label}
      data-tooltip={label}
      {...props}
    >
      {children}
    </button>
  );
}
