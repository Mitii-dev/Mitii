import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import type { AgentUiDepth, AgentUiMode } from '../protocol';
import { MODE_COLORS } from '../modeColors';
import {
  normalizeApproval,
  type ApprovalUiMode,
} from '../approvalPresets';
import {
  IconAgent,
  IconAsk,
  IconAskApproval,
  IconApproveForMe,
  IconCheck,
  IconDepthAuto,
  IconDepthDeep,
  IconDepthQuick,
  IconFullAccess,
  IconPlan,
  IconReview,
} from './Icons';

export type { ApprovalUiMode };
export { normalizeApproval };
export { MODE_COLORS };

type ComposerSelectId = 'mode' | 'approval' | 'depth';

interface ComposerOption<T extends string> {
  id: T;
  label: string;
  description: string;
  color: string;
  icon: ReactNode;
  /** Emphasize as a high-privilege / warning choice. */
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
    description: 'Implement with controlled execution',
    color: MODE_COLORS.agent,
    icon: <IconAgent />,
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Inspect diffs and report findings',
    color: MODE_COLORS.review,
    icon: <IconReview />,
  },
];

const APPROVAL_OPTIONS: ComposerOption<ApprovalUiMode>[] = [
  {
    id: 'safe',
    label: 'Ask for approval',
    description: 'Always ask before edits, commands, and network use',
    color: 'var(--mitii-text)',
    icon: <IconAskApproval />,
  },
  {
    id: 'guided',
    label: 'Approve for me',
    description: 'Approve tool use automatically; keep plan checkpoints',
    color: 'var(--mitii-text)',
    icon: <IconApproveForMe />,
  },
  {
    id: 'pilot',
    label: 'Full access',
    description: 'Unrestricted access to tools, network, and workspace files',
    color: '#e8b84a',
    icon: <IconFullAccess />,
    warning: true,
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
