/**
 * Enterprise identity pickers — Netflix-style workspace / profile choosers.
 */

import type { ReactNode } from 'react';

export type IdentityCard = {
  id: string;
  title: string;
  subtitle?: string;
  active?: boolean;
};

interface IdentityPickerProps {
  title: string;
  subtitle?: string;
  cards: IdentityCard[];
  onSelect: (id: string) => void;
  onAdd?: () => void;
  addLabel?: string;
  footer?: ReactNode;
}

export function IdentityPicker(props: IdentityPickerProps) {
  return (
    <div className="identity-picker">
      <header className="identity-picker__header">
        <h1>{props.title}</h1>
        {props.subtitle ? <p>{props.subtitle}</p> : null}
      </header>
      <div className="identity-picker__grid" role="list">
        {props.cards.map((card) => (
          <button
            key={card.id}
            type="button"
            role="listitem"
            className={`identity-card${card.active ? ' is-active' : ''}`}
            onClick={() => props.onSelect(card.id)}
          >
            <span className="identity-card__avatar" aria-hidden>
              {(card.title.trim()[0] || '?').toUpperCase()}
            </span>
            <span className="identity-card__title">{card.title}</span>
            {card.subtitle ? (
              <span className="identity-card__subtitle">{card.subtitle}</span>
            ) : null}
          </button>
        ))}
        {props.onAdd ? (
          <button
            type="button"
            className="identity-card identity-card--add"
            onClick={props.onAdd}
          >
            <span className="identity-card__avatar" aria-hidden>
              +
            </span>
            <span className="identity-card__title">
              {props.addLabel ?? 'Add'}
            </span>
          </button>
        ) : null}
      </div>
      {props.footer ? (
        <footer className="identity-picker__footer">{props.footer}</footer>
      ) : null}
    </div>
  );
}
