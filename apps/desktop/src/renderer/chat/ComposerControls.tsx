import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import type { DesktopAgentMode } from '../../shared/protocol.js';

export type ApprovalUiMode = 'safe' | 'guided' | 'pilot';
export type ThoroughnessUi = 'low' | 'medium' | 'high';

interface ComposerOption<T extends string> {
  id: T;
  label: string;
  description: string;
  color: string;
  warning?: boolean;
}

const MODE_COLORS = {
  ask: '#22c55e',
  plan: '#f59e0b',
  agent: '#ef4444',
} as const;

const MODES: ComposerOption<DesktopAgentMode>[] = [
  {
    id: 'ask',
    label: 'Ask',
    description: 'Explore and answer — read-only',
    color: MODE_COLORS.ask,
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Analyze and propose a structured plan',
    color: MODE_COLORS.plan,
  },
  {
    id: 'agent',
    label: 'Agent',
    description: 'Implement changes with controlled execution',
    color: MODE_COLORS.agent,
  },
];

const APPROVAL_OPTIONS: ComposerOption<ApprovalUiMode>[] = [
  {
    id: 'safe',
    label: 'Ask for approval',
    description: 'Pause before mutations and plan execution',
    color: '#38bdf8',
  },
  {
    id: 'guided',
    label: 'Approve for me',
    description: 'Auto-approve routine mutations; pause on risk',
    color: '#22c55e',
  },
  {
    id: 'pilot',
    label: 'Full access',
    description: 'Unrestricted tools, network, and workspace files',
    color: '#c9b27a',
    warning: true,
  },
];

const THOROUGHNESS_OPTIONS: ComposerOption<ThoroughnessUi>[] = [
  {
    id: 'low',
    label: 'Low',
    description: 'Quick look, lighter context',
    color: '#94a3b8',
  },
  {
    id: 'medium',
    label: 'Medium',
    description: 'Balanced depth for most tasks',
    color: '#38bdf8',
  },
  {
    id: 'high',
    label: 'High',
    description: 'Deep exploration, broader retrieval',
    color: '#f59e0b',
  },
];

type SelectId = 'mode' | 'approval' | 'thoroughness';

export function modeAccent(mode: DesktopAgentMode): string {
  return MODE_COLORS[mode] ?? MODE_COLORS.ask;
}

interface ComposerControlsProps {
  mode: DesktopAgentMode;
  approvalMode: ApprovalUiMode;
  thoroughness: ThoroughnessUi;
  disabled?: boolean;
  onModeChange: (mode: DesktopAgentMode) => void;
  onApprovalModeChange: (mode: ApprovalUiMode) => void;
  onThoroughnessChange: (value: ThoroughnessUi) => void;
}

export function ComposerControls({
  mode,
  approvalMode,
  thoroughness,
  disabled,
  onModeChange,
  onApprovalModeChange,
  onThoroughnessChange,
}: ComposerControlsProps) {
  const [openSelect, setOpenSelect] = useState<SelectId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeMode = MODES.find((m) => m.id === mode) ?? MODES[0]!;
  const activeApproval =
    APPROVAL_OPTIONS.find((o) => o.id === approvalMode) ?? APPROVAL_OPTIONS[1]!;
  const activeThoroughness =
    THOROUGHNESS_OPTIONS.find((o) => o.id === thoroughness) ??
    THOROUGHNESS_OPTIONS[1]!;

  useEffect(() => {
    if (!openSelect) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenSelect(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenSelect(null);
    };
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

    const margin = 8;
    const gap = 6;
    const buttonRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = buttonRect.left;
    let top = buttonRect.top - menuRect.height - gap;
    if (top < margin) top = buttonRect.bottom + gap;
    if (left + menuRect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - menuRect.width - margin);
    }
    menu.style.position = 'fixed';
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.bottom = 'auto';
    menu.style.right = 'auto';
    menu.style.zIndex = '1000';
    return () => {
      menu.style.position = '';
      menu.style.left = '';
      menu.style.top = '';
      menu.style.bottom = '';
      menu.style.right = '';
      menu.style.zIndex = '';
    };
  }, [openSelect]);

  const renderDropdown = <T extends string>({
    id,
    label,
    value,
    selected,
    options,
    onChange,
  }: {
    id: SelectId;
    label: string;
    value: T;
    selected: ComposerOption<T>;
    options: ComposerOption<T>[];
    onChange: (value: T) => void;
  }) => {
    const isOpen = openSelect === id;
    return (
      <div
        className={`composer-dropdown composer-dropdown--${id}`}
        style={
          {
            '--composer-control-color': selected.color,
          } as CSSProperties
        }
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
          onClick={() =>
            setOpenSelect((current) => (current === id ? null : id))
          }
        >
          <span className="composer-dropdown__value">{selected.label}</span>
          <span className="composer-dropdown__chevron" aria-hidden>
            ▾
          </span>
        </button>
        {isOpen ? (
          <div
            className="composer-dropdown__menu"
            role="listbox"
            aria-label={label}
          >
            {options.map((option) => {
              const selectedOption = option.id === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={[
                    'composer-dropdown__option',
                    selectedOption ? 'composer-dropdown__option--selected' : '',
                    option.warning ? 'composer-dropdown__option--warning' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={
                    {
                      '--composer-option-color': option.color,
                    } as CSSProperties
                  }
                  role="option"
                  aria-selected={selectedOption}
                  title={option.description}
                  onClick={() => {
                    onChange(option.id);
                    setOpenSelect(null);
                  }}
                >
                  <span className="composer-dropdown__option-text">
                    <span>{option.label}</span>
                    <small>{option.description}</small>
                  </span>
                  {selectedOption ? (
                    <span
                      className="composer-dropdown__option-check"
                      aria-hidden
                    >
                      ✓
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

  return (
    <div className="composer-controls" ref={rootRef} aria-label="Chat controls">
      {renderDropdown({
        id: 'mode',
        label: 'Mode',
        value: mode,
        selected: activeMode,
        options: MODES,
        onChange: onModeChange,
      })}
      {renderDropdown({
        id: 'approval',
        label: 'Approval',
        value: approvalMode,
        selected: activeApproval,
        options: APPROVAL_OPTIONS,
        onChange: onApprovalModeChange,
      })}
      {renderDropdown({
        id: 'thoroughness',
        label: 'Thoroughness',
        value: thoroughness,
        selected: activeThoroughness,
        options: THOROUGHNESS_OPTIONS,
        onChange: onThoroughnessChange,
      })}
    </div>
  );
}
