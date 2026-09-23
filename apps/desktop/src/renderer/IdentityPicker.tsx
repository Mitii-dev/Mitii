/**
 * Enterprise identity pickers — Netflix-style workspace / profile choosers.
 */

import type { ReactNode } from 'react';

import { IconPlus, IconTrash } from './ActivityIcons.js';

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
  /** Optional remove (hide from list). Does not delete on-disk project data. */
  onRemove?: (id: string) => void;
  removeLabel?: string;
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
          <div
            key={card.id}
            role="listitem"
            className={`identity-card-wrap${card.active ? ' is-active' : ''}`}
          >
            <button
              type="button"
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
            {props.onRemove ? (
              <button
                type="button"
                className="identity-card__remove"
                title={props.removeLabel ?? 'Remove from list'}
                aria-label={`${props.removeLabel ?? 'Remove'} ${card.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onRemove?.(card.id);
                }}
              >
                <IconTrash size={14} />
                <span>Remove</span>
              </button>
            ) : null}
          </div>
        ))}
        {props.onAdd ? (
          <button
            type="button"
            className="identity-card identity-card--add"
            onClick={props.onAdd}
          >
            <span className="identity-card__avatar" aria-hidden>
              <IconPlus size={22} />
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
