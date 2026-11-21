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
      <header className="settings-section__header">
        <h3 className="settings-section__title">{title}</h3>
        {description ? (
          <p className="settings-section__desc">{description}</p>
        ) : null}
      </header>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

export function KeyValueList({
  rows,
}: {
  rows: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="settings-kv">
      {rows.map((row) => (
        <div key={row.label} className="settings-kv__row">
          <dt>{row.label}</dt>
          <dd className="mono">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
