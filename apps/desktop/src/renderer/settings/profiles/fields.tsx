/** Profile editor field layout primitives. */

import { type ReactNode } from 'react';

export function Field(props: {
  id: string;
  label: string;
  hint?: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={`field${props.full ? ' full' : ''}`}
      htmlFor={props.id}
    >
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint ? <span className="field-help">{props.hint}</span> : null}
    </label>
  );
}

export function SettingsSection(props: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <header className="settings-section-header">
        <h3>{props.title}</h3>
        {props.description ? <p>{props.description}</p> : null}
      </header>
      <div className="settings-section-body">{props.children}</div>
    </section>
  );
}
