/** Shared settings layout primitives. */

import { type ReactNode } from 'react';

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <header className="settings-section-header">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

export function Field({
  id,
  label,
  hint,
  full,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`field${full ? ' full' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? <p className="field-help">{hint}</p> : null}
    </div>
  );
}
