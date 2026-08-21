import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import type {
  AgentUiMode,
  AgentUiThoroughness,
} from '../protocol';
import { MODE_COLORS } from '../modeColors';
import {
  IconAsk,
  IconAgent,
  IconApproveForMe,
  IconAskApproval,
  IconCheck,
  IconDepthDeep,
  IconEffortHigh,
  IconEffortLow,
  IconEffortMedium,
  IconFullAccess,
  IconPlan,
  IconReview,
} from './Icons';

export type ApprovalUiMode = 'safe' | 'guided' | 'pilot';

function normalizeApproval(value: string): ApprovalUiMode {
  if (value === 'safe' || value === 'pilot') return value;
  return 'guided';
}

interface ComposerOption<T extends string> {
  id: T;
  label: string;
  description: string;
  color: string;
  icon: ReactNode;
  warning?: boolean;
}

const MODES: ComposerOption<AgentUiMode>[] = [
  {
    id: 'ask',
    label: 'Ask',
    description: 'Explore and answer — read-only',
    color: MODE_COLORS.ask,
    icon: <IconAsk />,
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Analyze and propose a structured plan',
    color: MODE_COLORS.plan,
    icon: <IconPlan />,
  },
  {
    id: 'agent',
    label: 'Agent',
    description: 'Implement changes with controlled execution',
    color: MODE_COLORS.agent,
    icon: <IconAgent />,
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Inspect working-tree diffs and report findings',
    color: MODE_COLORS.review,
    icon: <IconReview />,
  },
];

const APPROVAL_OPTIONS: ComposerOption<ApprovalUiMode>[] = [
  {
    id: 'safe',
    label: 'Ask for approval',
    description: 'Pause before mutations and plan execution',
    color: '#38bdf8',
    icon: <IconAskApproval />,
  },
  {
    id: 'guided',
    label: 'Approve for me',
    description: 'Auto-approve routine mutations; pause on risk',
    color: '#22c55e',
    icon: <IconApproveForMe />,
  },
  {
    id: 'pilot',
    label: 'Full access',
    description: 'Unrestricted access to tools, network, and workspace files',
    color: '#c9b27a',
    icon: <IconFullAccess />,
    warning: true,
  },
];

const THOROUGHNESS_OPTIONS: ComposerOption<AgentUiThoroughness>[] = [
  {
    id: 'low',
    label: 'Low',
    description: 'Quick look, lighter context, fewer loop/repair calls',
    color: '#94a3b8',
    icon: <IconEffortLow />,
  },
  {
    id: 'medium',
    label: 'Medium',
    description: 'Balanced depth and working set for most tasks',
    color: '#38bdf8',
    icon: <IconEffortMedium />,
  },
  {
    id: 'high',
    label: 'High',
    description: 'Deep exploration, broader retrieval, more repairs',
    color: '#f59e0b',
    icon: <IconEffortHigh />,
  },
];

type ComposerSelectId = 'mode' | 'approval' | 'thoroughness';

export const MODE_HINT: Record<AgentUiMode, string> = {
  ask: 'Explore and answer — read-only.',
  plan: 'Analyze and propose a structured plan.',
  agent: 'Implement changes with controlled execution.',
  review: 'Inspect working-tree diffs and report findings.',
};

interface ComposerControlsProps {
  mode: AgentUiMode;
  approvalMode: string;
  thoroughness: AgentUiThoroughness;
  /** When true, thoroughness picker shows Custom until the user picks a level. */
  intensityCustom?: boolean;
  onModeChange: (mode: AgentUiMode) => void;
  onApprovalModeChange: (mode: ApprovalUiMode) => void;
  onThoroughnessChange: (thoroughness: AgentUiThoroughness) => void;
  includeReview?: boolean;
}

export function ComposerControls({
  mode,
  approvalMode,
  thoroughness,
  intensityCustom = false,
  onModeChange,
  onApprovalModeChange,
  onThoroughnessChange,
  includeReview = true,
}: ComposerControlsProps) {
  const [openSelect, setOpenSelect] = useState<ComposerSelectId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const modeOptions = includeReview
    ? MODES
    : MODES.filter((option) => option.id !== 'review');
  const activeMode = modeOptions.find((m) => m.id === mode) ?? modeOptions[0]!;
  const activeApproval =
    APPROVAL_OPTIONS.find((o) => o.id === normalizeApproval(approvalMode)) ??
    APPROVAL_OPTIONS[1]!;
  const activeThoroughness =
    THOROUGHNESS_OPTIONS.find((o) => o.id === thoroughness) ??
    THOROUGHNESS_OPTIONS[1]!;
  const thoroughnessSelected: ComposerOption<AgentUiThoroughness> =
    intensityCustom
      ? {
          id: thoroughness,
          label: 'Custom',
          description:
            'Developer intensity overrides are on — pick a level to reset',
          color: '#a78bfa',
          icon: <IconDepthDeep />,
        }
      : activeThoroughness;

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
    // Use capture:false and defer so the opening click doesn't race-close.
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

  const renderDropdown = <T extends string>({
    id,
    label,
    value,
    selected,
    options,
    onChange,
  }: {
    id: ComposerSelectId;
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
          className={`composer-dropdown__button composer-dropdown__button--link${selected.warning ? ' composer-dropdown__button--warning' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={label}
          title={`${label}: ${selected.description}`}
          onClick={() =>
            setOpenSelect((current) => (current === id ? null : id))
          }
        >
          <span className="composer-dropdown__value">
            <span className="composer-dropdown__icon" aria-hidden>
              {selected.icon}
            </span>
            <span>{selected.label}</span>
          </span>
          <span className="composer-dropdown__chevron" aria-hidden>
            ▾
          </span>
        </button>
        {isOpen ? (
          <div className="composer-dropdown__menu" role="listbox" aria-label={label}>
            {options.map((option) => {
                  const selectedOption =
                    option.id === value &&
                    !(id === 'thoroughness' && intensityCustom);
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
                  <span className="composer-dropdown__option-icon" aria-hidden>
                    {option.icon}
                  </span>
                  <span className="composer-dropdown__option-text">
                    <span>{option.label}</span>
                    <small>{option.description}</small>
                  </span>
                  {selectedOption ? (
                    <span className="composer-dropdown__option-check" aria-hidden>
                      <IconCheck />
                    </span>
                  ) : (
                    <span className="composer-dropdown__option-check" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="composer-dropdown-row" ref={rootRef} aria-label="Chat controls">
      {renderDropdown({
        id: 'mode',
        label: 'Mode',
        value: mode,
        selected: activeMode,
        options: modeOptions,
        onChange: onModeChange,
      })}
      {renderDropdown({
        id: 'approval',
        label: 'Approval',
        value: normalizeApproval(approvalMode),
        selected: activeApproval,
        options: APPROVAL_OPTIONS,
        onChange: onApprovalModeChange,
      })}
      {renderDropdown({
        id: 'thoroughness',
        label: 'Thoroughness',
        value: thoroughness,
        selected: thoroughnessSelected,
        options: THOROUGHNESS_OPTIONS,
        onChange: onThoroughnessChange,
      })}
    </div>
  );
}

export { normalizeApproval };
