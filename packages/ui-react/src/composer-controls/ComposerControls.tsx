import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';

import {
  CUSTOM_THOROUGHNESS_OPTION,
  DEFAULT_APPROVAL_OPTIONS,
  DEFAULT_DB_ACCESS_OPTIONS,
  DEFAULT_MODE_OPTIONS,
  DEFAULT_THOROUGHNESS_OPTIONS,
} from './defaults.js';
import type {
  ComposerControlIcons,
  ComposerControlsProps,
  ComposerIconKey,
  ComposerOption,
} from './types.js';

type SelectId = 'mode' | 'approval' | 'dbAccess' | 'thoroughness';

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 6;

interface DropdownSpec {
  id: SelectId;
  label: string;
  value: string;
  selected: ComposerOption;
  options: readonly ComposerOption[];
  onChange: (value: string) => void;
  /** Hide the "selected" mark on every row (custom thoroughness). */
  suppressSelection?: boolean;
}

function pickActive<T extends string>(
  options: readonly ComposerOption<T>[],
  value: T,
  fallbackIndex = 0,
): ComposerOption<T> {
  return (
    options.find((option) => option.id === value) ??
    options[fallbackIndex] ??
    options[0]!
  );
}

/** Pin an open menu to the viewport next to its trigger, flipping below when there is no room above. */
function usePinnedMenu(
  rootRef: RefObject<HTMLDivElement>,
  openSelect: SelectId | null,
  align: 'start' | 'center',
) {
  useLayoutEffect(() => {
    if (!openSelect || !rootRef.current) return;
    const dropdown = rootRef.current.querySelector<HTMLElement>(
      `.composer-dropdown--${openSelect}`,
    );
    const button = dropdown?.querySelector<HTMLElement>(
      '.composer-dropdown__button[aria-expanded="true"]',
    );
    const menu = dropdown?.querySelector<HTMLElement>('.composer-dropdown__menu');
    if (!button || !menu) return;

    const buttonRect = button.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const maxLeft = window.innerWidth - menuWidth - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - menuHeight - VIEWPORT_MARGIN;

    const anchorLeft =
      align === 'center'
        ? buttonRect.left + buttonRect.width / 2 - menuWidth / 2
        : buttonRect.left;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(anchorLeft, maxLeft));
    let top = buttonRect.top - menuHeight - MENU_GAP;
    if (top < VIEWPORT_MARGIN) top = buttonRect.bottom + MENU_GAP;
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop));

    const { style } = menu;
    style.position = 'fixed';
    style.left = `${left}px`;
    style.top = `${top}px`;
    style.bottom = 'auto';
    style.right = 'auto';
    style.transform = 'none';
    style.zIndex = '1000';
    return () => {
      style.position = '';
      style.left = '';
      style.top = '';
      style.bottom = '';
      style.right = '';
      style.transform = '';
      style.zIndex = '';
    };
  }, [rootRef, openSelect, align]);
}

function iconFor(icons: ComposerControlIcons | undefined, key: ComposerIconKey): ReactNode {
  return icons?.[key] ?? null;
}

/**
 * Composer pickers: mode, approval (or database access in Database mode), and
 * thoroughness. Presentation is class-name driven (`composer-controls`,
 * `composer-dropdown*`); hosts supply styling and icons.
 */
export function ComposerControls({
  mode,
  approvalMode,
  thoroughness,
  onModeChange,
  onApprovalModeChange,
  onThoroughnessChange,
  dbAccess = 'readonly',
  onDbAccessChange,
  intensityCustom = false,
  disabled,
  icons,
  checkIcon,
  modeOptions = DEFAULT_MODE_OPTIONS,
  approvalOptions = DEFAULT_APPROVAL_OPTIONS,
  thoroughnessOptions = DEFAULT_THOROUGHNESS_OPTIONS,
  dbAccessOptions = DEFAULT_DB_ACCESS_OPTIONS,
  menuAlign = 'start',
}: ComposerControlsProps) {
  const [openSelect, setOpenSelect] = useState<SelectId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const showDbAccess = mode === 'database' && onDbAccessChange !== undefined;
  const markSlotReserved = checkIcon !== undefined;

  useEffect(() => {
    if (!openSelect) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenSelect(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenSelect(null);
    };
    // Defer so the click that opened the menu cannot close it.
    const timer = window.setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown);
    }, 0);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openSelect]);

  usePinnedMenu(rootRef, openSelect, menuAlign);

  const renderDropdown = ({
    id,
    label,
    value,
    selected,
    options,
    onChange,
    suppressSelection,
  }: DropdownSpec) => {
    const isOpen = openSelect === id;
    const triggerIcon = iconFor(icons, selected.id as ComposerIconKey);
    return (
      <div
        className={`composer-dropdown composer-dropdown--${id}`}
        style={{ '--composer-control-color': selected.color } as CSSProperties}
      >
        <button
          type="button"
          className={`composer-dropdown__button composer-dropdown__button--link${
            selected.warning ? ' composer-dropdown__button--warning' : ''
          }`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={label}
          title={`${label}: ${selected.description}`}
          disabled={disabled}
          onClick={() => setOpenSelect((current) => (current === id ? null : id))}
        >
          <span className="composer-dropdown__value">
            {triggerIcon ? (
              <span className="composer-dropdown__icon" aria-hidden>
                {triggerIcon}
              </span>
            ) : null}
            <span>{selected.label}</span>
          </span>
          <span className="composer-dropdown__chevron" aria-hidden>
            ▾
          </span>
        </button>
        {isOpen ? (
          <div className="composer-dropdown__menu" role="listbox" aria-label={label}>
            {options.map((option) => {
              const isSelected = !suppressSelection && option.id === value;
              const optionIcon = iconFor(icons, option.id as ComposerIconKey);
              return (
                <button
                  key={option.id}
                  type="button"
                  className={[
                    'composer-dropdown__option',
                    isSelected ? 'composer-dropdown__option--selected' : '',
                    option.warning ? 'composer-dropdown__option--warning' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ '--composer-option-color': option.color } as CSSProperties}
                  role="option"
                  aria-selected={isSelected}
                  title={option.description}
                  onClick={() => {
                    onChange(option.id);
                    setOpenSelect(null);
                  }}
                >
                  {optionIcon ? (
                    <span className="composer-dropdown__option-icon" aria-hidden>
                      {optionIcon}
                    </span>
                  ) : null}
                  <span className="composer-dropdown__option-text">
                    <span>{option.label}</span>
                    <small>{option.description}</small>
                  </span>
                  {isSelected || markSlotReserved ? (
                    <span className="composer-dropdown__option-check" aria-hidden>
                      {isSelected ? (checkIcon ?? '✓') : null}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  const thoroughnessActive = intensityCustom
    ? CUSTOM_THOROUGHNESS_OPTION
    : pickActive(thoroughnessOptions, thoroughness, 1);

  return (
    <div className="composer-controls" ref={rootRef} aria-label="Chat controls">
      {renderDropdown({
        id: 'mode',
        label: 'Mode',
        value: mode,
        selected: pickActive(modeOptions, mode),
        options: modeOptions,
        onChange: (next) => onModeChange(next as typeof mode),
      })}
      {showDbAccess
        ? renderDropdown({
            id: 'dbAccess',
            label: 'DB access',
            value: dbAccess,
            selected: pickActive(dbAccessOptions, dbAccess),
            options: dbAccessOptions,
            onChange: (next) => onDbAccessChange(next as typeof dbAccess),
          })
        : renderDropdown({
            id: 'approval',
            label: 'Approval',
            value: approvalMode,
            selected: pickActive(approvalOptions, approvalMode, 1),
            options: approvalOptions,
            onChange: (next) => onApprovalModeChange(next as typeof approvalMode),
          })}
      {renderDropdown({
        id: 'thoroughness',
        label: 'Thoroughness',
        value: thoroughness,
        selected: thoroughnessActive,
        options: thoroughnessOptions,
        suppressSelection: intensityCustom,
        onChange: (next) => onThoroughnessChange(next as typeof thoroughness),
      })}
    </div>
  );
}
