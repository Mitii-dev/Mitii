import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import type { AgentUiDepth, AgentUiMode } from '../protocol';
import {
  IconAgent,
  IconAsk,
  IconBuilder,
  IconDepthAuto,
  IconDepthDeep,
  IconDepthQuick,
  IconGuided,
  IconPilot,
  IconPlan,
  IconReview,
  IconSafe,
} from './Icons';

export type ApprovalUiMode = 'safe' | 'guided' | 'builder' | 'pilot';

type ComposerSelectId = 'mode' | 'approval' | 'depth';

interface ComposerOption<T extends string> {
  id: T;
  label: string;
  description: string;
  color: string;
  icon: ReactNode;
}

const MODES: ComposerOption<AgentUiMode>[] = [
  {
    id: 'ask',
    label: 'Ask',
    description: 'Explore and answer — read-only',
    color: '#22c55e',
    icon: <IconAsk />,
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Analyze and propose a structured plan',
    color: '#f59e0b',
    icon: <IconPlan />,
  },
  {
    id: 'agent',
    label: 'Agent',
    description: 'Implement with controlled execution',
    color: '#ef4444',
    icon: <IconAgent />,
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Inspect diffs and report findings',
    color: '#38bdf8',
    icon: <IconReview />,
  },
];

const APPROVAL_OPTIONS: ComposerOption<ApprovalUiMode>[] = [
  {
    id: 'safe',
    label: 'Safe',
    description: 'Pause before edits and commands',
    color: '#ef4444',
    icon: <IconSafe />,
  },
  {
    id: 'guided',
    label: 'Guided',
    description: 'Pause before file edits',
    color: '#f59e0b',
    icon: <IconGuided />,
  },
  {
    id: 'builder',
    label: 'Builder',
    description: 'Pause before shell commands',
    color: '#fb923c',
    icon: <IconBuilder />,
  },
  {
    id: 'pilot',
    label: 'Pilot',
    description: 'Auto-approve allowed operations',
    color: '#22c55e',
    icon: <IconPilot />,
  },
];

const DEPTH_OPTIONS: ComposerOption<AgentUiDepth>[] = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Let Mitii choose depth',
    color: '#38bdf8',
    icon: <IconDepthAuto />,
  },
  {
    id: 'quick',
    label: 'Quick',
    description: 'Fast, lighter context',
    color: '#22c55e',
    icon: <IconDepthQuick />,
  },
  {
    id: 'deep',
    label: 'Deep',
    description: 'Broader retrieval and reasoning',
    color: '#a78bfa',
    icon: <IconDepthDeep />,
  },
];

export const MODE_HINT: Record<AgentUiMode, string> = {
  ask: 'Explore and answer — read-only.',
  plan: 'Analyze and propose a structured plan.',
  agent: 'Implement changes with controlled execution.',
  review: 'Inspect working-tree diffs and report findings.',
};

interface ComposerControlsProps {
  mode: AgentUiMode;
  approvalMode: string;
  depth: AgentUiDepth;
  onModeChange: (mode: AgentUiMode) => void;
  onApprovalModeChange: (mode: ApprovalUiMode) => void;
  onDepthChange: (depth: AgentUiDepth) => void;
  includeReview?: boolean;
}

function normalizeApproval(value: string): ApprovalUiMode {
  if (
    value === 'safe' ||
    value === 'guided' ||
    value === 'builder' ||
    value === 'pilot'
  ) {
    return value;
  }
  return 'guided';
}

export function ComposerControls({
  mode,
  approvalMode,
  depth,
  onModeChange,
  onApprovalModeChange,
  onDepthChange,
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
  const activeDepth =
    DEPTH_OPTIONS.find((o) => o.id === depth) ?? DEPTH_OPTIONS[0]!;

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
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
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
          className="composer-dropdown__button"
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
              const selectedOption = option.id === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`composer-dropdown__option${selectedOption ? ' composer-dropdown__option--selected' : ''}`}
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
        id: 'depth',
        label: 'Depth',
        value: depth,
        selected: activeDepth,
        options: DEPTH_OPTIONS,
        onChange: onDepthChange,
      })}
    </div>
  );
}
