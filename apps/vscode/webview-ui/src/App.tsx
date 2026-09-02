import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { onHostMessage, postToHost } from './bridge';
import { AutomationsPanel } from './components/AutomationsPanel';
import { ContextPanel, type ContextPin } from './components/ContextPanel';
import { ErrorBanner } from './components/ErrorBanner';
import { HistoryPanel } from './components/HistoryPanel';
import { IconButton } from './components/IconButton';
import {
  IconChat,
  IconCopy,
  IconHistory,
  IconCheck,
  IconLayers,
  IconModel,
  IconPlus,
  IconSend,
  IconSettings,
  IconSlash,
  IconStop,
  IconChevronDown,
} from './components/Icons';
import { IndexingStatusBar } from './components/IndexingStatusBar';
import type { ChatTurn, TurnSegment } from './components/MessageList';
import { MessageList } from './components/MessageList';
import {
  ComposerControls,
  normalizeApproval,
  type ApprovalUiMode,
} from './components/ComposerControls';
import { approvalModeUiPatch } from './approvalPresets';
import { OnboardingPanel } from './components/OnboardingPanel';
import { PendingPlanBanner } from './components/PendingPlanBanner';
import { PlanFollowStrip } from './components/PlanPanel';
import { ReviewPanel } from './components/ReviewPanel';
import { SettingsErrorBoundary } from './components/SettingsErrorBoundary';
import { SettingsPanel } from './components/SettingsPanel';
import { WorkspaceBanner } from './components/WorkspaceBanner';
import { deriveLiveTokenBudgetPreview } from '@mitii/live-token-budget';
import { getProviderPreset, modelsForProvider } from './providerOptions';
import {
  detectSkillMentionQuery,
  filterSkillSuggestions,
  skillCatalogSuggestSideEffects,
} from './skillSuggest';
import type {
  ActivityEventPayload,
  AgentUiDepth,
  AgentUiEffort,
  AgentUiMode,
  AgentUiThoroughness,
  AutomationRunView,
  AutomationSpecView,
  ChatThreadSummary,
  CheckpointItemView,
  ContextToggles,
  HostToWebviewMessage,
  IndexStatusSnapshot,
  McpRuntimeStatus,
  McpServerConfig,
  McpSettings,
  MemoryItemView,
  PathSuggestion,
  PlanView,
  ProviderSettingsSnapshot,
  ReviewDiffView,
  RunFileChangesView,
  SemanticIndexSource,
  SettingsTab,
  SettingsProfileView,
  SkillCatalogItem,
  TokenBudgetSettingsSnapshot,
  LoopPolicySettingsSnapshot,
  PolicyLabSettingsSnapshot,
  TokenUsageSnapshot,
  UiSettingsPatch,
  UiNav,
  UiSettingsSnapshot,
  WorkspaceNoticeView,
  WorkspaceSnapshotInfo,
} from './protocol';
import { modeColor } from './modeColors';
import { TokenMeter } from './TokenMeter';
import { resolveDisplayedAssistantText } from './assistantDisplay';
import type { ChatMessageView } from './protocol';
import {
  inferThoroughness,
  resolveRunIntensity,
  thoroughnessFromDepth,
  thoroughnessUiPatch,
} from './thoroughness';

const EMPTY_TOKEN_USAGE: TokenUsageSnapshot = {
  sessionTotal: 0,
  inputTokensTotal: 0,
  outputTokensTotal: 0,
  currentTurnTotal: 0,
  currentTurnInputTokens: 0,
  currentTurnOutputTokens: 0,
  aiCallCount: 0,
  modelCalls: 0,
  toolCalls: 0,
  loopIterations: 0,
  lastPromptTokens: 0,
  lastResponseTokens: 0,
  turnCount: 0,
  contextWindow: 32768,
  estimated: true,
  turns: [],
  live: false,
};

const DEFAULT_CONTEXT_TOGGLES: ContextToggles = {
  repoMap: true,
  diagnostics: true,
  gitDiff: true,
  editor: true,
  openTabs: false,
  memory: true,
};

const DEFAULT_RUN_BUDGET = {
  unlimited: false,
  maxModelCalls: 64,
  maxToolCalls: 128,
  maxLoopIterations: 96,
  maxWallTimeMinutes: 30,
};

const DEFAULT_TOKEN_BUDGET: TokenBudgetSettingsSnapshot = {
  enabled: false,
  policy: {},
  fields: [],
  preview: deriveLiveTokenBudgetPreview({
    contextWindowTokens: 32_768,
    runBudget: {
      unlimited: false,
      maxModelCalls: 64,
      maxToolCalls: 128,
    },
  }),
};

const DEFAULT_LOOP_POLICY: LoopPolicySettingsSnapshot = {
  enabled: false,
  thresholds: {},
  bandThresholds: {},
  band: {
    id: 'compact',
    label: 'Compact',
    rangeLabel: '< 50k',
    contextWindowTokens: 0,
  },
  fields: [],
};

const DEFAULT_POLICY_LAB: PolicyLabSettingsSnapshot = {
  enabled: false,
  filePath: 'packages/v8/.../loopPolicyBands.ts + windowBudgetBands.ts',
  exists: true,
  previewContextWindowTokens: 35_000,
  activeBand: {
    id: 'compact',
    label: 'Compact',
    rangeLabel: '< 50k',
    contextWindowTokens: 35_000,
  },
  editBand: 'compact',
  bands: [
    { id: 'compact', label: 'Compact', rangeLabel: '< 50k' },
    { id: 'standard', label: 'Standard', rangeLabel: '50k – < 100k' },
    { id: 'wide', label: 'Wide', rangeLabel: '≥ 100k' },
  ],
  loopByBand: { compact: {}, standard: {}, wide: {} },
  windowByBand: { compact: {}, standard: {}, wide: {} },
  loopOverrides: {},
  windowOverrides: {},
  loopThresholds: {},
  loopBandThresholds: {},
  windowPolicy: {},
  windowBandPolicy: {},
  loopFields: [],
  windowFields: [],
  loopBandHint: 'Compact (< 50k)',
  shipPreviewNote:
    'Save writes V8 source. Rebuild before runs use the new ship values.',
};

const DEFAULT_UI: UiSettingsSnapshot = {
  showReasoning: true,
  reasoningPreviewMaxChars: 8000,
  depth: 'auto',
  effort: 'medium',
  intensityOverrides: false,
  modeDefaults: {
    ask: {
      thoroughness: 'medium',
      depth: 'auto',
      approvalMode: 'guided',
      model: '',
    },
    plan: {
      thoroughness: 'high',
      depth: 'deep',
      approvalMode: 'guided',
      model: '',
    },
    agent: {
      thoroughness: 'medium',
      depth: 'auto',
      approvalMode: 'safe',
      model: '',
    },
  },
  contextToggles: DEFAULT_CONTEXT_TOGGLES,
  approvalMode: 'guided',
  runBudget: DEFAULT_RUN_BUDGET,
  developerEnabled: false,
  debugLogging: false,
  modelIoLogging: false,
  tokenBudget: DEFAULT_TOKEN_BUDGET,
  loopPolicy: DEFAULT_LOOP_POLICY,
  policyLab: DEFAULT_POLICY_LAB,
};

type SettingsMode = 'ask' | 'plan' | 'agent';

function hydrateUiSnapshot(
  raw: Partial<UiSettingsSnapshot> | undefined,
): UiSettingsSnapshot {
  return {
    ...DEFAULT_UI,
    ...(raw ?? {}),
    modeDefaults: {
      ...DEFAULT_UI.modeDefaults,
      ...(raw?.modeDefaults ?? {}),
    },
    contextToggles: {
      ...DEFAULT_CONTEXT_TOGGLES,
      ...(raw?.contextToggles ?? {}),
    },
    runBudget: {
      ...DEFAULT_RUN_BUDGET,
      ...(raw?.runBudget ?? {}),
    },
    tokenBudget: {
      ...DEFAULT_TOKEN_BUDGET,
      ...(raw?.tokenBudget ?? {}),
      policy: {
        ...DEFAULT_TOKEN_BUDGET.policy,
        ...(raw?.tokenBudget?.policy ?? {}),
      },
      fields: raw?.tokenBudget?.fields?.length
        ? raw.tokenBudget.fields
        : DEFAULT_TOKEN_BUDGET.fields,
      preview: raw?.tokenBudget?.preview ?? DEFAULT_TOKEN_BUDGET.preview,
    },
    loopPolicy: {
      ...DEFAULT_LOOP_POLICY,
      ...(raw?.loopPolicy ?? {}),
      thresholds: {
        ...DEFAULT_LOOP_POLICY.thresholds,
        ...(raw?.loopPolicy?.thresholds ?? {}),
      },
      bandThresholds: {
        ...DEFAULT_LOOP_POLICY.bandThresholds,
        ...(raw?.loopPolicy?.bandThresholds ?? {}),
      },
      band: raw?.loopPolicy?.band ?? DEFAULT_LOOP_POLICY.band,
      fields: raw?.loopPolicy?.fields?.length
        ? raw.loopPolicy.fields
        : DEFAULT_LOOP_POLICY.fields,
    },
    policyLab: {
      ...DEFAULT_POLICY_LAB,
      ...(raw?.policyLab ?? {}),
      activeBand: raw?.policyLab?.activeBand ?? DEFAULT_POLICY_LAB.activeBand,
      bands: raw?.policyLab?.bands?.length
        ? raw.policyLab.bands
        : DEFAULT_POLICY_LAB.bands,
      loopByBand: {
        compact: {
          ...DEFAULT_POLICY_LAB.loopByBand.compact,
          ...(raw?.policyLab?.loopByBand?.compact ?? {}),
        },
        standard: {
          ...DEFAULT_POLICY_LAB.loopByBand.standard,
          ...(raw?.policyLab?.loopByBand?.standard ?? {}),
        },
        wide: {
          ...DEFAULT_POLICY_LAB.loopByBand.wide,
          ...(raw?.policyLab?.loopByBand?.wide ?? {}),
        },
      },
      windowByBand: {
        compact: {
          ...DEFAULT_POLICY_LAB.windowByBand.compact,
          ...(raw?.policyLab?.windowByBand?.compact ?? {}),
        },
        standard: {
          ...DEFAULT_POLICY_LAB.windowByBand.standard,
          ...(raw?.policyLab?.windowByBand?.standard ?? {}),
        },
        wide: {
          ...DEFAULT_POLICY_LAB.windowByBand.wide,
          ...(raw?.policyLab?.windowByBand?.wide ?? {}),
        },
      },
      loopOverrides: {
        ...DEFAULT_POLICY_LAB.loopOverrides,
        ...(raw?.policyLab?.loopOverrides ?? {}),
      },
      windowOverrides: {
        ...DEFAULT_POLICY_LAB.windowOverrides,
        ...(raw?.policyLab?.windowOverrides ?? {}),
      },
      loopThresholds: {
        ...DEFAULT_POLICY_LAB.loopThresholds,
        ...(raw?.policyLab?.loopThresholds ?? {}),
      },
      loopBandThresholds: {
        ...DEFAULT_POLICY_LAB.loopBandThresholds,
        ...(raw?.policyLab?.loopBandThresholds ?? {}),
      },
      windowPolicy: {
        ...DEFAULT_POLICY_LAB.windowPolicy,
        ...(raw?.policyLab?.windowPolicy ?? {}),
      },
      windowBandPolicy: {
        ...DEFAULT_POLICY_LAB.windowBandPolicy,
        ...(raw?.policyLab?.windowBandPolicy ?? {}),
      },
      loopFields: raw?.policyLab?.loopFields?.length
        ? raw.policyLab.loopFields
        : DEFAULT_POLICY_LAB.loopFields,
      windowFields: raw?.policyLab?.windowFields?.length
        ? raw.policyLab.windowFields
        : DEFAULT_POLICY_LAB.windowFields,
      shipPreviewNote:
        raw?.policyLab?.shipPreviewNote ?? DEFAULT_POLICY_LAB.shipPreviewNote,
    },
  };
}

function settingsModeFor(mode: AgentUiMode): SettingsMode {
  return mode === 'plan' || mode === 'agent' ? mode : 'ask';
}

function modeDefaultsFromUi(ui: UiSettingsSnapshot, mode: AgentUiMode) {
  const settingsMode = settingsModeFor(mode);
  const fallback = DEFAULT_UI.modeDefaults[settingsMode];
  const current = ui.modeDefaults?.[settingsMode];
  const depth = current?.depth ?? ui.depth ?? fallback.depth;
  const thoroughness =
    current?.thoroughness ??
    inferThoroughness(depth, ui.effort) ??
    thoroughnessFromDepth(depth) ??
    fallback.thoroughness;
  return {
    thoroughness,
    depth,
    approvalMode:
      current?.approvalMode ?? ui.approvalMode ?? fallback.approvalMode,
    model: current?.model ?? fallback.model,
  };
}

function mergeUiPatch(
  base: UiSettingsSnapshot,
  patch: UiSettingsPatch,
): UiSettingsSnapshot {
  const {
    contextToggles: _ct,
    modeDefaults: _md,
    runBudget: _rb,
    tokenBudget: _tb,
    loopPolicy: _lp,
    policyLab: _pl,
    ...scalarPatch
  } = patch;
  return {
    ...base,
    ...scalarPatch,
    contextToggles: patch.contextToggles
      ? { ...base.contextToggles, ...patch.contextToggles }
      : base.contextToggles,
    modeDefaults: patch.modeDefaults
      ? {
          ...base.modeDefaults,
          ask: {
            ...base.modeDefaults.ask,
            ...patch.modeDefaults.ask,
          },
          plan: {
            ...base.modeDefaults.plan,
            ...patch.modeDefaults.plan,
          },
          agent: {
            ...base.modeDefaults.agent,
            ...patch.modeDefaults.agent,
          },
        }
      : base.modeDefaults,
    runBudget: patch.runBudget
      ? { ...base.runBudget, ...patch.runBudget }
      : base.runBudget,
    tokenBudget: patch.tokenBudget
      ? {
          ...base.tokenBudget,
          ...patch.tokenBudget,
          policy: {
            ...base.tokenBudget.policy,
            ...(patch.tokenBudget.policy ?? {}),
          },
          fields: base.tokenBudget.fields,
          preview: base.tokenBudget.preview,
        }
      : base.tokenBudget,
    loopPolicy: patch.loopPolicy
      ? {
          ...base.loopPolicy,
          ...patch.loopPolicy,
          thresholds: {
            ...base.loopPolicy.thresholds,
            ...(patch.loopPolicy.thresholds ?? {}),
          },
          bandThresholds: {
            ...base.loopPolicy.bandThresholds,
            ...(patch.loopPolicy.bandThresholds ?? {}),
          },
          band: patch.loopPolicy.band ?? base.loopPolicy.band,
          fields: base.loopPolicy.fields,
        }
      : base.loopPolicy,
    policyLab: patch.policyLab
      ? {
          ...base.policyLab,
          ...patch.policyLab,
          loopByBand: {
            compact: {
              ...base.policyLab.loopByBand.compact,
              ...(patch.policyLab.loopByBand?.compact ?? {}),
            },
            standard: {
              ...base.policyLab.loopByBand.standard,
              ...(patch.policyLab.loopByBand?.standard ?? {}),
            },
            wide: {
              ...base.policyLab.loopByBand.wide,
              ...(patch.policyLab.loopByBand?.wide ?? {}),
            },
          },
          windowByBand: {
            compact: {
              ...base.policyLab.windowByBand.compact,
              ...(patch.policyLab.windowByBand?.compact ?? {}),
            },
            standard: {
              ...base.policyLab.windowByBand.standard,
              ...(patch.policyLab.windowByBand?.standard ?? {}),
            },
            wide: {
              ...base.policyLab.windowByBand.wide,
              ...(patch.policyLab.windowByBand?.wide ?? {}),
            },
          },
          loopOverrides: {
            ...base.policyLab.loopOverrides,
            ...(patch.policyLab.loopOverrides ?? {}),
          },
          windowOverrides: {
            ...base.policyLab.windowOverrides,
            ...(patch.policyLab.windowOverrides ?? {}),
          },
          loopThresholds: {
            ...base.policyLab.loopThresholds,
            ...(patch.policyLab.loopThresholds ?? {}),
          },
          windowPolicy: {
            ...base.policyLab.windowPolicy,
            ...(patch.policyLab.windowPolicy ?? {}),
          },
          loopBandThresholds: base.policyLab.loopBandThresholds,
          windowBandPolicy: base.policyLab.windowBandPolicy,
          loopFields: base.policyLab.loopFields,
          windowFields: base.policyLab.windowFields,
          bands: base.policyLab.bands,
          activeBand: patch.policyLab.activeBand ?? base.policyLab.activeBand,
          shipPreviewNote:
            patch.policyLab.shipPreviewNote ?? base.policyLab.shipPreviewNote,
        }
      : base.policyLab,
  };
}

function clearStaleModeModelDefaultsAfterProviderModelChange(params: {
  ui: UiSettingsSnapshot;
  previousProviderModel: string;
  nextProviderModel: string;
}): UiSettingsSnapshot {
  const previous = params.previousProviderModel.trim();
  const next = params.nextProviderModel.trim();
  if (!previous || previous === next) return params.ui;
  let changed = false;
  const modeDefaults = { ...params.ui.modeDefaults };
  for (const mode of ['ask', 'plan', 'agent'] as const) {
    if ((modeDefaults[mode].model ?? '').trim() !== previous) continue;
    changed = true;
    modeDefaults[mode] = {
      ...modeDefaults[mode],
      model: '',
    };
  }
  return changed ? { ...params.ui, modeDefaults } : params.ui;
}

/** Tool titles switch from "Running X" (started) to plain "X" (completed) — normalize so both merge into one row. */
function activityMergeKey(event: { kind: string; title: string }): string {
  if (event.kind === 'tool') {
    return `tool:${event.title.replace(/^Running\s+/, '')}`;
  }
  return `${event.kind}:${event.title}`;
}

function shouldReplaceActivity(
  existing: { kind: string; title: string; status?: string },
  incoming: { kind: string; title: string; status?: string },
): boolean {
  if (activityMergeKey(existing) !== activityMergeKey(incoming)) return false;
  return Boolean(existing.status || incoming.status);
}

const MAX_SEGMENTS = 160;

/**
 * Appends an activity event to the trailing run of activity segments.
 * Thinking deltas have no `status`, so they merge purely on contiguity with
 * the immediately preceding thinking entry (one growing "Thought" per
 * uninterrupted reasoning phase). Other kinds merge into a matching in-flight
 * entry further back (e.g. a tool's running→done transition) via
 * shouldReplaceActivity, so status updates don't spawn duplicate rows. Either
 * way the search never crosses a text segment boundary — once the model
 * resumes writing prose, a later event starts a fresh step.
 */
function appendActivitySegment(
  segments: TurnSegment[],
  incoming: ActivityEventPayload,
  reasoningPreviewMaxChars: number,
): TurnSegment[] {
  const last = segments[segments.length - 1];

  if (
    incoming.kind === 'thinking' &&
    last?.kind === 'activity' &&
    last.event.kind === 'thinking'
  ) {
    const detail = `${last.event.detail ?? ''}${incoming.detail ?? ''}`.slice(
      -reasoningPreviewMaxChars,
    );
    const next = [...segments];
    next[next.length - 1] = {
      ...last,
      // Keep the original start time so the eventual "Thought for Xs" reflects
      // the whole reasoning phase, not just the gap since the last delta.
      event: { ...last.event, ...incoming, detail, at: last.event.at },
    };
    return next;
  }

  if (incoming.kind !== 'thinking') {
    let start = segments.length;
    while (start > 0 && segments[start - 1]!.kind === 'activity') start -= 1;

    for (let i = segments.length - 1; i >= start; i -= 1) {
      const seg = segments[i]!;
      if (
        seg.kind !== 'activity' ||
        seg.event.kind === 'thinking' ||
        !shouldReplaceActivity(seg.event, incoming)
      ) {
        continue;
      }
      const next = [...segments];
      next[i] = {
        ...seg,
        event: {
          ...seg.event,
          ...incoming,
          detail: incoming.detail ?? seg.event.detail,
          at: seg.event.at,
        },
      };
      return next;
    }
  }

  const next: TurnSegment[] = [
    ...segments,
    { id: uid('seg'), kind: 'activity', event: incoming },
  ];
  return next.length > MAX_SEGMENTS ? next.slice(-MAX_SEGMENTS) : next;
}

/** Appends a text delta, continuing the trailing text segment or starting a new one after an activity phase. */
function appendTextSegment(segments: TurnSegment[], text: string): TurnSegment[] {
  const last = segments[segments.length - 1];
  if (last?.kind === 'text') {
    const next = [...segments];
    next[next.length - 1] = { ...last, text: `${last.text}${text}` };
    return next;
  }
  return [...segments, { id: uid('seg'), kind: 'text', text, at: Date.now() }];
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Operational budget/context notices — not actionable UI warnings. */
function isNoiseWarning(detail: string): boolean {
  return /context (file|item) limit prevented|context token budget prevented|default token estimate was used|leftover context was smaller|turn output tokens reduced/i.test(
    detail,
  );
}

function toChatTurn(message: ChatMessageView): ChatTurn {
  const segments: TurnSegment[] = (message.activity ?? [])
    .filter(
      (event) =>
        !(
          event.kind === 'warning' &&
          event.detail?.trim() &&
          isNoiseWarning(event.detail)
        ),
    )
    .map((event) => ({
      id: uid('seg'),
      kind: 'activity' as const,
      event,
    }));
  const warnings = (message.activity ?? [])
    .filter(
      (event) =>
        event.kind === 'warning' &&
        event.detail?.trim() &&
        !isNoiseWarning(event.detail),
    )
    .map((event) => event.detail!.trim());
  if (message.text.trim()) {
    segments.push({
      id: uid('seg'),
      kind: 'text',
      text: message.text,
      at: Date.now(),
    });
  }
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    segments,
    ...(warnings.length ? { warnings } : {}),
    mode: message.mode,
    ...(message.fileChanges ? { fileChanges: message.fileChanges } : {}),
    ...(message.status ? { status: message.status } : {}),
    ...(message.route !== undefined ? { route: message.route } : {}),
  };
}

function mergeModelOptions(
  available: string[] | undefined,
  current: string,
): string[] {
  const set = new Set<string>();
  if (current.trim()) set.add(current.trim());
  for (const id of available ?? []) {
    if (id.trim()) set.add(id.trim());
  }
  return [...set];
}

interface ModelQuickSelectProps {
  label: string;
  value: string;
  custom: boolean;
  options: string[];
  onSelect: (value: string) => void;
  onCustomMode: () => void;
  onDraftChange: (value: string) => void;
  onCommitCustom: () => void;
}

function ModelQuickSelect({
  label,
  value,
  custom,
  options,
  onSelect,
  onCustomMode,
  onDraftChange,
  onCommitCustom,
}: ModelQuickSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
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
  }, [open]);

  return (
    <div className="model-quick-select" ref={rootRef}>
      <button
        type="button"
        className="model-quick-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Model: ${label}`}
        onClick={() => setOpen((current) => !current)}
      >
        <IconModel />
        <span>{label}</span>
      </button>
      {open ? (
        <div className="model-quick-select__menu" role="listbox" aria-label="Model">
          {options.map((id) => {
            const selected = !custom && id === value;
            return (
              <button
                key={id}
                type="button"
                className={`model-quick-select__option${selected ? ' is-selected' : ''}`}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onSelect(id);
                  setOpen(false);
                }}
              >
                <span className="model-quick-select__option-text">{id}</span>
                <span className="model-quick-select__check" aria-hidden>
                  {selected ? <IconCheck /> : null}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className={`model-quick-select__option${custom ? ' is-selected' : ''}`}
            role="option"
            aria-selected={custom}
            onClick={() => {
              onCustomMode();
              setOpen(false);
            }}
          >
            <span className="model-quick-select__option-text">Custom model</span>
            <span className="model-quick-select__check" aria-hidden>
              {custom ? <IconCheck /> : null}
            </span>
          </button>
        </div>
      ) : null}
      {custom ? (
        <input
          className="model-custom-input model-custom-input--inline"
          value={value}
          placeholder="model id"
          onChange={(event) => onDraftChange(event.target.value)}
          onBlur={onCommitCustom}
          title="Custom model id"
        />
      ) : null}
    </div>
  );
}

export function App() {
  const [nav, setNav] = useState<UiNav>('chat');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('model');
  const [mode, setMode] = useState<AgentUiMode>('ask');
  const [depth, setDepth] = useState<AgentUiDepth>('auto');
  const [effort, setEffort] = useState<AgentUiEffort>('medium');
  const [thoroughness, setThoroughness] =
    useState<AgentUiThoroughness>('medium');
  const [approvalMode, setApprovalMode] = useState<ApprovalUiMode>('guided');
  const [prompt, setPrompt] = useState('');
  const [pinned, setPinned] = useState<ContextPin[]>([]);
  const [pinnedSkillIds, setPinnedSkillIds] = useState<string[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestKind, setSuggestKind] = useState<'path' | 'skill'>('path');
  const [activeSuggest, setActiveSuggest] = useState(0);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshotInfo>({});
  const [provider, setProvider] = useState<ProviderSettingsSnapshot>({
    type: 'echo',
    baseUrl: '',
    model: '',
    hasApiKey: false,
    availableModels: [],
    contextWindow: 0,
    effectiveContextWindow: 32768,
    maximumOutputTokens: 0,
  });
  const [profiles, setProfiles] = useState<SettingsProfileView[]>([]);
  const [activeProfileId, setActiveProfileId] = useState('default');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [tokenUsage, setTokenUsage] =
    useState<TokenUsageSnapshot>(EMPTY_TOKEN_USAGE);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );
  const [customModel, setCustomModel] = useState(false);
  const [index, setIndex] = useState<IndexStatusSnapshot>({
    fileCount: 0,
    truncated: false,
  });
  const [mcp, setMcp] = useState<McpSettings>({ enabled: false, servers: [] });
  const [mcpStore, setMcpStore] = useState<McpServerConfig[]>([]);
  const [mcpRuntimeStatus, setMcpRuntimeStatus] =
    useState<McpRuntimeStatus>('disabled');
  const [ui, setUi] = useState<UiSettingsSnapshot>(DEFAULT_UI);
  const [clarifyText, setClarifyText] = useState('');
  const [overrideDraft, setOverrideDraft] = useState('');
  const [notice, setNotice] = useState<WorkspaceNoticeView | null>(null);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [history, setHistory] = useState<ChatThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | undefined>();
  const [memories, setMemories] = useState<MemoryItemView[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointItemView[]>([]);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PlanView | null>(null);
  const pendingPlanRef = useRef<PlanView | null>(null);

  const [review, setReview] = useState<ReviewDiffView | null>(null);
  const [skillItems, setSkillItems] = useState<SkillCatalogItem[]>([]);
  const [automationSpecs, setAutomationSpecs] = useState<AutomationSpecView[]>(
    [],
  );
  const [automationRuns, setAutomationRuns] = useState<AutomationRunView[]>([]);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationError, setAutomationError] = useState<string | null>(null);

  const searchReq = useRef(0);
  const lastSearchId = useRef('');
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(false);
  const lastTurnCountRef = useRef(0);
  const activeAssistantId = useRef<string | null>(null);
  const modeRef = useRef<AgentUiMode>(mode);
  const uiRef = useRef<UiSettingsSnapshot>(ui);
  const providerRef = useRef<ProviderSettingsSnapshot>(provider);
  const indexRef = useRef<IndexStatusSnapshot>(index);
  const savedProviderModelRef = useRef(provider.model);
  const listModelsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedModeDefaults = useRef(false);
  const readySentRef = useRef(false);
  /** Unsaved provider connection edits — bootstrap must not wipe these. */
  const providerDraftDirtyRef = useRef(false);
  const settingsSavingRef = useRef(false);
  /** Paths the user removed; skip auto-re-pin while the file stays open. */
  const dismissedAutoPinsRef = useRef(new Set<string>());

  const updateProvider = (
    next:
      | ProviderSettingsSnapshot
      | ((prev: ProviderSettingsSnapshot) => ProviderSettingsSnapshot),
  ) => {
    const resolved =
      typeof next === 'function' ? next(providerRef.current) : next;
    providerRef.current = resolved;
    setProvider(resolved);
  };

  const applyTokenUsage = useCallback(
    (usage: TokenUsageSnapshot) => {
      setTokenUsage((prev) => {
        const shouldKeepLiveBreakdown =
          usage.contextBreakdown === undefined && usage.live && prev.live;
        const current = providerRef.current;
        const providerContextWindow =
          current.effectiveContextWindow || current.contextWindow;
        return {
          ...usage,
          contextWindow:
            usage.contextWindow ||
            providerContextWindow ||
            prev.contextWindow ||
            32768,
          contextBreakdown:
            usage.contextBreakdown ??
            (shouldKeepLiveBreakdown ? prev.contextBreakdown : undefined),
        };
      });
    },
    [],
  );

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior) => {
    const scroll = () => {
      const target = messagesRef.current;
      if (!target) return;
      bottomRef.current?.scrollIntoView({ block: 'end', behavior });
      target.scrollTop = target.scrollHeight;
    };
    window.requestAnimationFrame(() => {
      scroll();
      window.requestAnimationFrame(scroll);
    });
  }, []);

  const navigate = useCallback(
    (next: UiNav, nextSettingsTab?: SettingsTab) => {
      setNav(next);
      if (nextSettingsTab) setSettingsTab(nextSettingsTab);
      postToHost({
        type: 'navigate',
        nav: next,
        settingsTab: nextSettingsTab,
      });
    },
    [],
  );

  const applyBootstrap = useCallback((msg: HostToWebviewMessage) => {
    if (msg.type === 'bootstrap' || msg.type === 'settings') {
      setWorkspace(msg.workspace);
      const draft = providerRef.current;
      const preserveDraft =
        providerDraftDirtyRef.current && !settingsSavingRef.current;
      const nextContextWindow = Number.isFinite(msg.provider.contextWindow)
        ? Math.max(0, Math.floor(msg.provider.contextWindow))
        : 0;
      const nextEffectiveContextWindow = Number.isFinite(
        msg.provider.effectiveContextWindow,
      )
        ? Math.max(1, Math.floor(msg.provider.effectiveContextWindow ?? 0))
        : undefined;
      const nextMaximumOutputTokens = Number.isFinite(
        msg.provider.maximumOutputTokens,
      )
        ? Math.max(0, Math.floor(msg.provider.maximumOutputTokens))
        : 0;
      const nextModel = preserveDraft
        ? draft.model
        : (msg.provider.model ?? '');
      updateProvider({
        type: preserveDraft ? draft.type : msg.provider.type,
        preset: preserveDraft ? draft.preset : msg.provider.preset,
        baseUrl: preserveDraft ? draft.baseUrl : msg.provider.baseUrl,
        model: nextModel,
        hasApiKey: msg.provider.hasApiKey,
        availableModels: mergeModelOptions(
          [
            ...(msg.provider.availableModels ?? []),
            ...(preserveDraft ? (draft.availableModels ?? []) : []),
          ],
          nextModel,
        ),
        contextWindow: preserveDraft ? draft.contextWindow : nextContextWindow,
        effectiveContextWindow: nextEffectiveContextWindow,
        maximumOutputTokens: preserveDraft
          ? draft.maximumOutputTokens
          : nextMaximumOutputTokens,
        connectionOk: msg.provider.connectionOk,
        connectionStatus: msg.provider.connectionStatus,
      });
      if (!preserveDraft) {
        providerDraftDirtyRef.current = false;
        savedProviderModelRef.current = msg.provider.model ?? '';
      }
      setProfiles(msg.profiles ?? []);
      setActiveProfileId(msg.activeProfileId ?? 'default');
      setMcp(msg.mcp);
      setMcpStore(msg.mcpStore ?? []);
      setMcpRuntimeStatus(msg.mcpRuntimeStatus);
      const nextUi = hydrateUiSnapshot(msg.ui);
      const previousUi = uiRef.current;
      uiRef.current = nextUi;
      setUi(nextUi);
      const modeDefaultsChanged =
        JSON.stringify(previousUi.modeDefaults) !==
          JSON.stringify(nextUi.modeDefaults) ||
        previousUi.depth !== nextUi.depth ||
        previousUi.approvalMode !== nextUi.approvalMode;
      if (!hydratedModeDefaults.current || modeDefaultsChanged) {
        hydratedModeDefaults.current = true;
        const currentDefaults = modeDefaultsFromUi(nextUi, modeRef.current);
        const intensity = resolveRunIntensity({
          intensityOverrides: nextUi.intensityOverrides === true,
          thoroughness: currentDefaults.thoroughness,
          depth: currentDefaults.depth,
          effort: nextUi.effort,
        });
        setThoroughness(intensity.thoroughness);
        setDepth(intensity.depth);
        setEffort(intensity.effort);
        setApprovalMode(normalizeApproval(currentDefaults.approvalMode));
      } else {
        setEffort(nextUi.effort ?? 'medium');
      }
      setOverrideDraft(msg.workspace.rootOverride ?? '');
      applyTokenUsage(msg.tokenUsage);
      setNotice(msg.notice);
      setCustomModel((wasCustom) => {
        const catalog = new Set([
          ...(preserveDraft
            ? (draft.availableModels ?? [])
            : (msg.provider.availableModels ?? [])),
          ...(msg.provider.availableModels ?? []),
          ...modelsForProvider(
            (preserveDraft ? draft.preset : msg.provider.preset) ??
              (preserveDraft ? draft.type : msg.provider.type),
          ),
        ]);
        return Boolean(nextModel.trim()) && (wasCustom || !catalog.has(nextModel));
      });
      if (msg.provider.connectionStatus) {
        setConnectionMessage(msg.provider.connectionStatus);
      }
      settingsSavingRef.current = false;
      setSettingsSaving(false);
      if (msg.type === 'bootstrap') {
        setIndex(msg.index);
        setOnboardingRequired(msg.onboardingRequired);
        setHistory(msg.history);
        setActiveThreadId(msg.activeThreadId);
        if (!activeAssistantId.current) {
          setTurns(
            (msg.activeThreadMessages ?? []).map((m) => toChatTurn(m)),
          );
        }
        const bootstrapPlan = msg.pendingPlan ?? null;
        setPendingPlan(bootstrapPlan);
        if (bootstrapPlan) setPlan(bootstrapPlan);
        setMemories(msg.memories);
        setCheckpoints(msg.checkpoints);
      }
    }
  }, [applyTokenUsage]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    uiRef.current = ui;
  }, [ui]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const markSuspensionResumed = useCallback((runId: string) => {
    setRunning(true);
    setTurns((prev) =>
      prev.map((turn) =>
        turn.suspension?.runId === runId
          ? { ...turn, suspension: undefined, streaming: true }
          : turn,
      ),
    );
  }, []);

  useEffect(() => {
    pendingPlanRef.current = pendingPlan;
  }, [pendingPlan]);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      switch (msg.type) {
        case 'bootstrap':
        case 'settings':
          applyBootstrap(msg);
          break;
        case 'index.status':
          setIndex(msg.index);
          break;
        case 'run.started': {
          setRunning(true);
          setError(null);
          // Keep a pending-plan handoff visible, but clear stale plans for new runs.
          if (msg.mode === 'plan' || !pendingPlanRef.current) setPlan(null);
          stickToBottomRef.current = true;
          forceScrollToBottomRef.current = true;
          const userId = uid('user');
          const asstId = uid('asst');
          activeAssistantId.current = asstId;
          setTurns((prev) => [
            ...prev,
            {
              id: userId,
              role: 'user',
              text: msg.prompt,
              mode: msg.mode,
              segments: [],
            },
            {
              id: asstId,
              role: 'assistant',
              text: '',
              mode: msg.mode,
              streaming: true,
              segments: [],
              warnings: [],
            },
          ]);
          break;
        }
        case 'run.event': {
          const id = activeAssistantId.current;
          if (!id) break;
          if (msg.event.kind === 'delta') break;
          if (msg.event.kind === 'thinking' && !uiRef.current.showReasoning) break;
          // "Preparing tool" is a transient placeholder immediately superseded
          // by "Running <tool>" a moment later — drop it, it adds noise without signal.
          if (msg.event.kind === 'tool' && msg.event.title === 'Preparing tool') {
            break;
          }
          // Budget/context operational notices — hide from banner and timeline.
          if (
            msg.event.kind === 'warning' &&
            msg.event.detail?.trim() &&
            isNoiseWarning(msg.event.detail)
          ) {
            break;
          }
          setTurns((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    warnings:
                      msg.event.kind === 'warning' && msg.event.detail?.trim()
                        ? Array.from(
                            new Set([...(t.warnings ?? []), msg.event.detail.trim()]),
                          )
                        : t.warnings,
                    segments: appendActivitySegment(
                      t.segments,
                      msg.event,
                      uiRef.current.reasoningPreviewMaxChars,
                    ),
                  }
                : t,
            ),
          );
          break;
        }
        case 'run.delta': {
          const id = activeAssistantId.current;
          if (!id) break;
          setTurns((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    text: `${t.text}${msg.text}`,
                    segments: appendTextSegment(t.segments, msg.text),
                  }
                : t,
            ),
          );
          break;
        }
        case 'run.suspended': {
          setRunning(false);
          const id = activeAssistantId.current;
          if (!id) break;
          setTurns((prev) =>
            prev.map((t) =>
              t.id === id
                ? { ...t, suspension: msg.suspension, streaming: false }
                : t,
            ),
          );
          break;
        }
        case 'run.resumed':
          markSuspensionResumed(msg.runId);
          break;
        case 'run.result': {
          setRunning(false);
          const id = activeAssistantId.current;
          activeAssistantId.current = null;
          if (msg.plan !== undefined) setPlan(msg.plan ?? null);
          if (msg.pendingPlan !== undefined) {
            setPendingPlan(msg.pendingPlan);
            if (msg.pendingPlan) setPlan(msg.pendingPlan);
          }
          setTurns((prev) =>
            prev.map((t) => {
              if (!id || t.id !== id) return t;
              const nextText = resolveDisplayedAssistantText({
                streamedText: t.text,
                finalAnswer: msg.answer?.trim()
                  ? msg.answer
                  : msg.error
                    ? `Error: ${msg.error}`
                    : `(${msg.status})`,
              });
              // Streamed segments already display correctly; only when the
              // final answer overrides them do we collapse the streamed text
              // into one trailing segment, keeping prior activity groups intact.
              const segments =
                nextText === t.text
                  ? t.segments
                  : [
                      ...t.segments.filter((seg) => seg.kind === 'activity'),
                      {
                        id: uid('seg'),
                        kind: 'text' as const,
                        text: nextText,
                        at: Date.now(),
                      },
                    ];
              return {
                ...t,
                streaming: false,
                status: msg.status,
                route: msg.route,
                text: nextText,
                segments,
                suspension: undefined,
              };
            }),
          );
          break;
        }
        case 'run.cancelled':
          setRunning(false);
          break;
        case 'error':
          setError(msg.message);
          setRunning(false);
          setSettingsSaving(false);
          break;
        case 'paths.results':
          if (msg.requestId === lastSearchId.current) {
            setSuggestions(msg.suggestions);
            setSuggestLoading(false);
            setSuggestOpen(true);
            setActiveSuggest(0);
          }
          break;
        case 'openSettings':
          setNav('settings');
          if (msg.tab) setSettingsTab(msg.tab);
          break;
        case 'setTab':
          setNav(msg.tab);
          break;
        case 'editorPin':
          setPinned((prev) => {
            const source = msg.source ?? 'auto';
            if (source === 'user') {
              dismissedAutoPinsRef.current.delete(msg.path);
            } else if (dismissedAutoPinsRef.current.has(msg.path)) {
              return prev;
            }
            const existing = prev.find((p) => p.path === msg.path);
            if (existing) {
              // Promote auto → user when explicitly pinned again as user.
              if (source === 'user' && existing.source === 'auto') {
                return prev.map((p) =>
                  p.path === msg.path ? { ...p, source: 'user' } : p,
                );
              }
              return prev;
            }
            return [...prev, { path: msg.path, source }];
          });
          break;
        case 'editorUnpin':
          setPinned((prev) =>
            prev.filter(
              (p) => !(p.path === msg.path && p.source === 'auto'),
            ),
          );
          break;
        case 'syncAutoPins': {
          const open = new Set(msg.paths);
          // Allow auto-pin again after the file is closed and reopened.
          for (const path of [...dismissedAutoPinsRef.current]) {
            if (!open.has(path)) dismissedAutoPinsRef.current.delete(path);
          }
          setPinned((prev) => {
            const kept = prev.filter(
              (p) => p.source === 'user' || open.has(p.path),
            );
            const known = new Set(kept.map((p) => p.path));
            const additions = msg.paths
              .filter(
                (path) =>
                  !known.has(path) &&
                  !dismissedAutoPinsRef.current.has(path),
              )
              .map((path) => ({ path, source: 'auto' as const }));
            return [...kept, ...additions];
          });
          break;
        }
        case 'run.fileChanges': {
          const id = activeAssistantId.current;
          setTurns((prev) => {
            const targetId =
              id ??
              [...prev]
                .reverse()
                .find((turn) => turn.role === 'assistant')?.id;
            if (!targetId) return prev;
            return prev.map((t) =>
              t.id === targetId ? { ...t, fileChanges: msg.changes } : t,
            );
          });
          break;
        }
        case 'fileChanges.undone': {
          setTurns((prev) =>
            prev.map((t) =>
              t.fileChanges?.runId === msg.runId
                ? { ...t, fileChanges: undefined }
                : t,
            ),
          );
          break;
        }
        case 'workspaceNotice':
          setNotice(msg.notice);
          break;
        case 'history':
          setHistory(msg.threads);
          setActiveThreadId(msg.activeThreadId);
          break;
        case 'thread.loaded': {
          setActiveThreadId(msg.threadId);
          stickToBottomRef.current = true;
          forceScrollToBottomRef.current = true;
          setTokenUsage({
            ...EMPTY_TOKEN_USAGE,
            contextWindow:
              providerRef.current.effectiveContextWindow ||
              providerRef.current.contextWindow ||
              provider.effectiveContextWindow ||
              provider.contextWindow ||
              32768,
          });
          setTurns(msg.messages.map((m) => toChatTurn(m)));
          const loadedPlan = msg.pendingPlan ?? null;
          setPendingPlan(loadedPlan);
          setPlan(loadedPlan);
          setNav('chat');
          break;
        }
        case 'setPlan':
          setPlan(msg.plan);
          break;
        case 'setReviewDiff':
          setReview(msg.review);
          break;
        case 'setMemories':
          setMemories(msg.memories);
          break;
        case 'setCheckpoints':
          setCheckpoints(msg.checkpoints);
          break;
        case 'skillCatalogResult': {
          const suggestEffects = skillCatalogSuggestSideEffects(
            msg.requestId,
            lastSearchId.current,
          );
          if (!suggestEffects) {
            break;
          }
          setSkillItems(msg.items);
          setSuggestLoading(false);
          setSuggestOpen(suggestEffects.suggestOpen);
          setActiveSuggest(suggestEffects.activeSuggest);
          break;
        }
        case 'automationsResult':
          setAutomationSpecs(msg.specs);
          setAutomationRuns(msg.runs);
          setAutomationError(msg.error ?? null);
          setAutomationLoading(false);
          break;
        case 'onboarding':
          setOnboardingRequired(msg.required);
          break;
        case 'provider.connectionResult':
          setTestingConnection(Boolean(msg.testing));
          setConnectionMessage(msg.message);
          if (Array.isArray(msg.models)) {
            updateProvider((p) => ({
              ...p,
              availableModels: mergeModelOptions(msg.models ?? [], p.model),
              connectionOk: msg.ok,
              connectionStatus: msg.message,
            }));
            if ((msg.models?.length ?? 0) > 0) {
              setCustomModel(false);
            }
          } else if (!msg.testing) {
            updateProvider((p) => ({
              ...p,
              connectionOk: msg.ok,
              connectionStatus: msg.message,
            }));
          }
          break;
        case 'provider.models':
          updateProvider((p) => ({
            ...p,
            availableModels: mergeModelOptions(msg.models, p.model),
          }));
          break;
        case 'tokenUsage':
          applyTokenUsage(msg.usage);
          break;
        default:
          break;
      }
    });
    if (!readySentRef.current) {
      readySentRef.current = true;
      postToHost({ type: 'ready' });
    }
    return off;
  }, [applyBootstrap, applyTokenUsage, markSuspensionResumed]);

  useLayoutEffect(() => {
    const turnCountChanged = turns.length !== lastTurnCountRef.current;
    lastTurnCountRef.current = turns.length;
    const shouldScroll =
      forceScrollToBottomRef.current ||
      stickToBottomRef.current ||
      (running && turnCountChanged);
    if (!shouldScroll) return;
    forceScrollToBottomRef.current = false;
    scrollMessagesToBottom(running ? 'auto' : 'smooth');
  }, [running, scrollMessagesToBottom, turns]);

  const onMessagesScroll = useCallback(() => {
    const target = messagesRef.current;
    if (!target) return;
    const distanceFromBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 72;
  }, []);

  const send = useCallback(() => {
    const text = prompt.trim();
    if (!text || running) return;
    stickToBottomRef.current = true;
    forceScrollToBottomRef.current = true;
    const defaults = modeDefaultsFromUi(ui, mode);
    const intensity = resolveRunIntensity({
      intensityOverrides: ui.intensityOverrides === true,
      thoroughness: defaults.thoroughness,
      depth: defaults.depth,
      effort: ui.effort,
    });
    postToHost({
      type: 'ask',
      prompt: text,
      mode,
      depth: intensity.depth,
      effort: intensity.effort,
      approvalMode,
      pinnedPaths: pinned.map((p) => p.path),
      requiredSkillIds: pinnedSkillIds,
    });
    setPrompt('');
    setPinnedSkillIds([]);
    setSuggestLoading(false);
    setSuggestOpen(false);
  }, [prompt, running, mode, ui, approvalMode, pinned, pinnedSkillIds]);

  const executePendingPlan = useCallback(() => {
    if (running) return;
    stickToBottomRef.current = true;
    forceScrollToBottomRef.current = true;
    const agentDefaults = modeDefaultsFromUi(ui, 'agent');
    const intensity = resolveRunIntensity({
      intensityOverrides: ui.intensityOverrides === true,
      thoroughness: agentDefaults.thoroughness,
      depth: agentDefaults.depth,
      effort: ui.effort,
    });
    setMode('agent');
    setThoroughness(intensity.thoroughness);
    setDepth(intensity.depth);
    setEffort(intensity.effort);
    setApprovalMode(normalizeApproval(agentDefaults.approvalMode));
    const nextModel = agentDefaults.model?.trim();
    if (nextModel) saveModel(nextModel, { clearStaleModeDefaults: false });
    postToHost({
      type: 'ask',
      prompt: 'Implement the pending plan.',
      mode: 'agent',
      depth: intensity.depth,
      effort: intensity.effort,
      approvalMode: agentDefaults.approvalMode,
      pinnedPaths: pinned.map((p) => p.path),
      requiredSkillIds: pinnedSkillIds,
    });
    setPrompt('');
    setPinnedSkillIds([]);
    setSuggestLoading(false);
    setSuggestOpen(false);
  }, [running, ui, pinned, pinnedSkillIds]);

  const onPromptChange = (value: string) => {
    setPrompt(value);
    const skillQuery = detectSkillMentionQuery(value);
    if (skillQuery !== null) {
      setSuggestKind('skill');
      setSuggestQuery(skillQuery);
      const requestId = String(++searchReq.current);
      lastSearchId.current = requestId;
      setSuggestLoading(true);
      setSuggestOpen(true);
      postToHost({
        type: 'requestSkillCatalog',
        requestId,
        query: skillQuery || undefined,
      });
      return;
    }
    const match = value.match(/@([\w./_-]*)$/);
    if (match) {
      const q = match[1] ?? '';
      setSuggestKind('path');
      setSuggestQuery(q);
      const requestId = String(++searchReq.current);
      lastSearchId.current = requestId;
      setSuggestLoading(true);
      setSuggestOpen(true);
      postToHost({ type: 'paths.search', query: q, requestId });
    } else {
      setSuggestLoading(false);
      setSuggestOpen(false);
    }
  };

  const insertMention = (path: string) => {
    const replaced = prompt.replace(/@([\w./_-]*)$/, `@${path} `);
    setPrompt(replaced);
    dismissedAutoPinsRef.current.delete(path);
    setPinned((prev) => {
      const existing = prev.find((p) => p.path === path);
      if (existing) {
        return existing.source === 'user'
          ? prev
          : prev.map((p) =>
              p.path === path ? { ...p, source: 'user' } : p,
            );
      }
      return [...prev, { path, source: 'user' }];
    });
    setSuggestLoading(false);
    setSuggestOpen(false);
  };

  const insertSkillMention = (skillId: string) => {
    const replaced = prompt.replace(
      /@skill:[a-z0-9_.-]*$/i,
      `@skill:${skillId} `,
    );
    setPrompt(replaced);
    setPinnedSkillIds((prev) =>
      prev.includes(skillId) ? prev : [...prev, skillId].slice(0, 3),
    );
    setSuggestLoading(false);
    setSuggestOpen(false);
  };

  const pinSkill = (skillId: string) => {
    setPinnedSkillIds((prev) =>
      prev.includes(skillId) ? prev : [...prev, skillId].slice(0, 3),
    );
    setSuggestLoading(false);
    setSuggestOpen(false);
  };

  const selectSkill = (skillId: string) => {
    if (/@skill:[a-z0-9_.-]*$/i.test(prompt)) {
      insertSkillMention(skillId);
      return;
    }
    pinSkill(skillId);
  };

  const openSkillPicker = () => {
    setSuggestKind('skill');
    setSuggestQuery('');
    setActiveSuggest(0);
    const requestId = String(++searchReq.current);
    lastSearchId.current = requestId;
    setSuggestLoading(true);
    setSuggestOpen(true);
    postToHost({
      type: 'requestSkillCatalog',
      requestId,
      query: undefined,
    });
    promptTextareaRef.current?.focus();
  };

  const filteredSkillSuggestions = filterSkillSuggestions(
    skillItems,
    suggestQuery,
  );

  const openFile = useCallback(
    (path: string, line?: number, column?: number) => {
      postToHost({ type: 'openFile', path, line, column });
    },
    [],
  );

  const undoFileChanges = useCallback((runId: string) => {
    postToHost({ type: 'undoFileChanges', runId });
  }, []);

  const reviewFileChange = useCallback((runId: string, path: string) => {
    postToHost({ type: 'reviewFileChange', runId, path });
  }, []);

  const reviewAllFileChanges = useCallback((changes: RunFileChangesView) => {
    setMode('review');
    postToHost({ type: 'refreshReviewDiff' });
    for (const file of changes.files.slice(0, 1)) {
      postToHost({
        type: 'reviewFileChange',
        runId: changes.runId,
        path: file.path,
      });
    }
  }, []);

  const dismissFileChanges = useCallback((runId: string) => {
    postToHost({ type: 'dismissFileChanges', runId });
    setTurns((prev) =>
      prev.map((t) =>
        t.fileChanges?.runId === runId
          ? { ...t, fileChanges: undefined }
          : t,
      ),
    );
  }, []);

  const currentModeColor = modeColor(mode);

  const testConnection = () => {
    setTestingConnection(true);
    setConnectionMessage('Testing…');
    const current = providerRef.current;
    postToHost({
      type: 'provider.testConnection',
      provider: {
        type: current.type,
        baseUrl: current.baseUrl,
        model: current.model,
      },
    });
  };

  const requestListedModels = (
    type: string,
    baseUrl: string,
    immediate = false,
  ) => {
    if (listModelsTimerRef.current) {
      clearTimeout(listModelsTimerRef.current);
      listModelsTimerRef.current = null;
    }
    const send = () => {
      if (type === 'echo') return;
      postToHost({
        type: 'provider.listModels',
        provider: { type, baseUrl },
      });
    };
    if (immediate) {
      send();
      return;
    }
    listModelsTimerRef.current = setTimeout(send, 400);
  };

  const handleProviderChange = (
    next:
      | ProviderSettingsSnapshot
      | ((prev: ProviderSettingsSnapshot) => ProviderSettingsSnapshot),
  ) => {
    const before = providerRef.current;
    updateProvider(next);
    const after = providerRef.current;
    if (
      after.type !== before.type ||
      after.preset !== before.preset ||
      after.baseUrl !== before.baseUrl ||
      after.model !== before.model ||
      after.contextWindow !== before.contextWindow ||
      after.maximumOutputTokens !== before.maximumOutputTokens
    ) {
      providerDraftDirtyRef.current = true;
    }
    if (after.model.trim() !== before.model.trim()) {
      const nextUi = clearStaleModeModelDefaultsAfterProviderModelChange({
        ui: uiRef.current,
        previousProviderModel: before.model,
        nextProviderModel: after.model,
      });
      if (nextUi !== uiRef.current) {
        uiRef.current = nextUi;
        setUi(nextUi);
      }
    }
    if (after.type !== before.type) {
      requestListedModels(after.type, after.baseUrl, true);
    } else if (after.baseUrl !== before.baseUrl) {
      requestListedModels(after.type, after.baseUrl);
    }
  };

  const onProviderTypeChange = (presetId: string) => {
    const preset = getProviderPreset(presetId);
    const type = preset?.type ?? presetId;
    providerDraftDirtyRef.current = true;
    updateProvider((p) => ({
      ...p,
      type,
      preset: preset?.preset ?? presetId,
      baseUrl: preset?.baseUrl ?? p.baseUrl,
      model: preset?.model ?? p.model,
      availableModels: [],
      connectionOk: undefined,
      connectionStatus: undefined,
    }));
    setConnectionMessage(null);
    setCustomModel(false);
    const current = providerRef.current;
    requestListedModels(current.type, current.baseUrl, true);
  };

  const modelOptions = useMemo(
    () =>
      mergeModelOptions(
        [
          ...modelsForProvider(provider.preset ?? provider.type),
          ...(provider.availableModels ?? []),
        ],
        provider.model,
      ),
    [provider.availableModels, provider.model, provider.preset, provider.type],
  );
  const selectedModelIsCustom =
    customModel || !modelOptions.includes(provider.model);
  const selectedModelLabel = selectedModelIsCustom
    ? provider.model.trim() || 'Custom model'
    : provider.model || 'Select model';

  const saveModel = (
    model: string,
    options: { clearStaleModeDefaults?: boolean } = {},
  ) => {
    const previousModel = savedProviderModelRef.current;
    updateProvider((p) => ({ ...p, model }));
    let uiPatch: UiSettingsPatch | undefined;
    if (options.clearStaleModeDefaults !== false) {
      const nextUi = clearStaleModeModelDefaultsAfterProviderModelChange({
        ui: uiRef.current,
        previousProviderModel: previousModel,
        nextProviderModel: model,
      });
      if (nextUi !== uiRef.current) {
        uiRef.current = nextUi;
        setUi(nextUi);
        uiPatch = { modeDefaults: nextUi.modeDefaults };
      }
    }
    postToHost({
      type: 'settings.set',
      provider: { model },
      ui: uiPatch,
    });
  };

  const changeApprovalMode = (next: ApprovalUiMode) => {
    const patch = approvalModeUiPatch({ mode, approvalMode: next });
    updateUiDraft(patch);
    postToHost({
      type: 'settings.set',
      ui: patch,
      approvalMode: patch.approvalMode,
    });
    setApprovalMode(patch.approvalMode);
  };

  const changeMode = (next: AgentUiMode) => {
    setMode(next);
    const defaults = modeDefaultsFromUi(ui, next);
    const intensity = resolveRunIntensity({
      intensityOverrides: ui.intensityOverrides === true,
      thoroughness: defaults.thoroughness,
      depth: defaults.depth,
      effort: ui.effort,
    });
    setThoroughness(intensity.thoroughness);
    setDepth(intensity.depth);
    setEffort(intensity.effort);
    setApprovalMode(normalizeApproval(defaults.approvalMode));
    const nextModel = defaults.model?.trim();
    if (nextModel) saveModel(nextModel, { clearStaleModeDefaults: false });
    if (next === 'review') postToHost({ type: 'refreshReviewDiff' });
  };

  const changeThoroughness = (next: AgentUiThoroughness) => {
    const settingsMode = settingsModeFor(mode);
    const patch = thoroughnessUiPatch({
      mode: settingsMode,
      thoroughness: next,
    });
    updateUiDraft(patch);
    postToHost({ type: 'settings.set', ui: patch });
    setThoroughness(next);
    setDepth(patch.modeDefaults[settingsMode]!.depth);
    setEffort(patch.effort);
  };

  const updateUiDraft = (patch: UiSettingsPatch) => {
    const next = mergeUiPatch(uiRef.current, patch);
    uiRef.current = next;
    setUi(next);
    if (patch.depth) setDepth(patch.depth);
    if (patch.effort) setEffort(patch.effort);
    const activeModePatch = patch.modeDefaults?.[settingsModeFor(mode)];
    const activeModeDepth = activeModePatch?.depth;
    if (activeModeDepth) setDepth(activeModeDepth);
    if (activeModePatch?.thoroughness) {
      setThoroughness(activeModePatch.thoroughness);
    }
    if (activeModePatch?.approvalMode) {
      setApprovalMode(normalizeApproval(activeModePatch.approvalMode));
    }
    const activeModeModel = activeModePatch?.model?.trim();
    if (activeModeModel) {
      updateProvider((prev) => ({
        ...prev,
        model: activeModeModel,
      }));
    }
  };

  const activeProfile = useMemo(
    () =>
      profiles.find((profile) => profile.id === activeProfileId) ??
      profiles[0],
    [activeProfileId, profiles],
  );
  const selectedProfileLabel = activeProfile?.name ?? 'Default';

  const snapshotProvider = () => {
    const current = providerRef.current;
    return {
      type: current.type,
      preset: current.preset,
      baseUrl: current.baseUrl,
      model: current.model,
      contextWindow: current.contextWindow,
      maximumOutputTokens: current.maximumOutputTokens,
    };
  };

  const applyProfileLocally = (profile: SettingsProfileView) => {
    setActiveProfileId(profile.id);
    savedProviderModelRef.current = profile.provider.model ?? '';
    updateProvider({
      ...profile.provider,
      hasApiKey: profile.hasSecret,
      availableModels: [],
      connectionOk: undefined,
      connectionStatus: undefined,
    });
    setConnectionMessage(null);
    if (profile.provider.type && profile.provider.type !== 'echo') {
      requestListedModels(
        profile.provider.type,
        profile.provider.baseUrl ?? '',
        true,
      );
    }
    if (profile.ui) {
      const nextUi = hydrateUiSnapshot(profile.ui);
      uiRef.current = nextUi;
      setUi(nextUi);
      const defaults = modeDefaultsFromUi(nextUi, modeRef.current);
      const intensity = resolveRunIntensity({
        intensityOverrides: nextUi.intensityOverrides === true,
        thoroughness: defaults.thoroughness,
        depth: defaults.depth,
        effort: nextUi.effort,
      });
      setThoroughness(intensity.thoroughness);
      setDepth(intensity.depth);
      setEffort(intensity.effort);
      setApprovalMode(normalizeApproval(defaults.approvalMode));
    }
  };

  const switchProfile = (id: string) => {
    const profile = profiles.find((entry) => entry.id === id);
    if (!profile || profile.id === activeProfileId) return;
    providerDraftDirtyRef.current = false;
    applyProfileLocally(profile);
    postToHost({ type: 'profile.switch', id: profile.id });
  };

  const createProfile = (name: string) => {
    const id = `profile-${Date.now().toString(36)}`;
    const trimmed = name.trim() || 'New profile';
    const nextProfile: SettingsProfileView = {
      id,
      name: trimmed,
      provider: snapshotProvider(),
      hasSecret: provider.hasApiKey,
      ui: uiRef.current,
    };
    setProfiles((prev) => [...prev, nextProfile]);
    providerDraftDirtyRef.current = false;
    applyProfileLocally(nextProfile);
    settingsSavingRef.current = true;
    setSettingsSaving(true);
    postToHost({
      type: 'settings.set',
      provider: snapshotProvider(),
      profile: nextProfile,
    });
  };

  const saveAllSettings = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const latestProvider = snapshotProvider();
    const latestUi = clearStaleModeModelDefaultsAfterProviderModelChange({
      ui: mergeUiPatch(
        uiRef.current,
        approvalModeUiPatch({ mode, approvalMode }),
      ),
      previousProviderModel: savedProviderModelRef.current,
      nextProviderModel: latestProvider.model,
    });
    uiRef.current = latestUi;
    setUi(latestUi);
    const profile = activeProfile ?? {
      id: activeProfileId || 'default',
      name: 'Default',
      provider: latestProvider,
      hasSecret: provider.hasApiKey,
    };
    settingsSavingRef.current = true;
    setSettingsSaving(true);
    postToHost({
      type: 'settings.set',
      provider: latestProvider,
      ui: latestUi,
      workspaceRootOverride: overrideDraft.trim() || null,
      workspaceMaximumIndexFiles: indexRef.current.maximumIndexFiles ?? 0,
      mcp,
      approvalMode,
      profile: {
        ...profile,
        provider: latestProvider,
      },
    });
    setTokenUsage((prev) => ({
      ...prev,
      contextWindow:
        providerRef.current.effectiveContextWindow ||
        providerRef.current.contextWindow ||
        prev.contextWindow,
    }));
  };

  const requestAutomations = () => {
    setAutomationLoading(true);
    postToHost({ type: 'requestAutomations', requestId: uid('auto') });
  };

  useEffect(() => {
    if (nav === 'automations') requestAutomations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  const followingPlan = mode === 'plan' && Boolean(plan?.steps.length);

  if (onboardingRequired) {
    return (
      <div className="app">
        <header className="shell-header">
          <div className="brand">
            <div className="brand-mark">Mitii</div>
            <div className="brand-sub">First-run setup</div>
          </div>
        </header>
        <OnboardingPanel
          index={index}
          onIndex={() => postToHost({ type: 'index.reindex' })}
          onComplete={() => {
            postToHost({ type: 'completeOnboarding' });
            setOnboardingRequired(false);
          }}
          onOpenSettings={() => {
            setOnboardingRequired(false);
            navigate('settings', 'model');
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="shell-header">
        <div className="brand" aria-label="Mitii">
          <div className="brand-mark">Mitii</div>
        </div>
        <div className="shell-header__actions">
          <nav className="nav-pills" aria-label="Primary">
            {nav === 'chat' ? (
              <IconButton
                label="New chat"
                onClick={() => {
                  postToHost({ type: 'newChat' });
                  setTurns([]);
                  setPlan(null);
                  setPendingPlan(null);
                  setActiveThreadId(undefined);
                  setTokenUsage(EMPTY_TOKEN_USAGE);
                }}
              >
                <IconPlus />
              </IconButton>
            ) : null}
            <IconButton
              label="Chat"
              active={nav === 'chat'}
              onClick={() => navigate('chat')}
            >
              <IconChat />
            </IconButton>
            <IconButton
              label="History"
              active={nav === 'history'}
              onClick={() => navigate('history')}
            >
              <IconHistory />
            </IconButton>
            <IconButton
              label="Settings"
              active={nav === 'settings'}
              onClick={() => navigate('settings', settingsTab)}
            >
              <IconSettings />
            </IconButton>
            <IconButton
              label="Automations"
              active={nav === 'automations'}
              onClick={() => navigate('automations')}
            >
              <IconLayers />
            </IconButton>
          </nav>
          <IndexingStatusBar
            index={index}
            onRefresh={() => postToHost({ type: 'index.refresh' })}
            onOpenSettings={() => navigate('settings', 'workspace')}
          />
          <label className="shell-header__profile" title={`Profile: ${selectedProfileLabel}`}>
            <span className="shell-header__profile-label">{selectedProfileLabel}</span>
            <IconChevronDown width={12} height={12} />
            <select
              aria-label="Profile"
              value={activeProfileId}
              onChange={(e) => switchProfile(e.target.value)}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <ErrorBanner
        error={error}
        onDismiss={() => setError(null)}
        onSettings={() => navigate('settings', 'model')}
      />
      <WorkspaceBanner notice={notice} workspace={workspace} />

      {nav === 'chat' ? (
        mode === 'review' ? (
          <div className="chat-view">
            <ReviewPanel
              review={review}
              onRefresh={() => postToHost({ type: 'refreshReviewDiff' })}
              onOpenFile={openFile}
              onOpenDiff={(path) =>
                postToHost({ type: 'reviewWorkspaceFile', path })
              }
            />
            <div className="composer-dock">
              <ComposerControls
                mode={mode}
                approvalMode={approvalMode}
                thoroughness={thoroughness}
                intensityCustom={
                  ui.intensityOverrides === true &&
                  inferThoroughness(depth, effort) === undefined
                }
                onModeChange={changeMode}
                onApprovalModeChange={changeApprovalMode}
                onThoroughnessChange={changeThoroughness}
              />
            </div>
          </div>
        ) : (
          <div className={`chat-view${running ? ' chat-view--running' : ''}`}>
            <MessageList
              turns={turns}
              clarifyText={clarifyText}
              onClarifyChange={setClarifyText}
              onResumeClarify={(runId, answer) => {
                postToHost({
                  type: 'resume',
                  runId,
                  clarificationAnswer: answer,
                });
                markSuspensionResumed(runId);
                setClarifyText('');
              }}
              onResumeStop={(runId) => postToHost({ type: 'resume', runId })}
              onApprove={(runId, approvalId) => {
                const turn = turns.find((t) => t.suspension?.runId === runId);
                if (turn?.suspension?.kind === 'plan_approval_required') {
                  postToHost({
                    type: 'resume',
                    runId,
                    planDecision: { decision: 'approved' },
                  });
                  markSuspensionResumed(runId);
                  return;
                }
                if (!approvalId) return;
                postToHost({
                  type: 'resume',
                  runId,
                  approval: { approvalId, decision: 'approved' },
                });
                markSuspensionResumed(runId);
              }}
              onDeny={(runId, approvalId) => {
                const turn = turns.find((t) => t.suspension?.runId === runId);
                if (turn?.suspension?.kind === 'plan_approval_required') {
                  postToHost({
                    type: 'resume',
                    runId,
                    planDecision: { decision: 'rejected' },
                  });
                  markSuspensionResumed(runId);
                  return;
                }
                if (!approvalId) return;
                postToHost({
                  type: 'resume',
                  runId,
                  approval: { approvalId, decision: 'denied' },
                });
                markSuspensionResumed(runId);
              }}
              onShowInlineDiff={(approvalId) =>
                postToHost({ type: 'showInlineDiff', approvalId })
              }
              onOpenFile={openFile}
              onUndoFileChanges={undoFileChanges}
              onReviewFileChange={reviewFileChange}
              onReviewAllFileChanges={reviewAllFileChanges}
              onDismissFileChanges={dismissFileChanges}
              showWarnings={ui.developerEnabled === true}
              containerRef={messagesRef}
              onScroll={onMessagesScroll}
              bottomRef={bottomRef}
            />

            <div className="composer-dock">
              <PendingPlanBanner
                visible={Boolean(pendingPlan) && mode !== 'agent'}
                onExecuteInAgent={executePendingPlan}
                onDismiss={() => {
                  setPendingPlan(null);
                  setPlan(null);
                  postToHost({ type: 'clearPendingPlan' });
                }}
              />
              {followingPlan ? (
                <PlanFollowStrip
                  plan={plan}
                  running={running}
                  onOpenPlanFile={openFile}
                />
              ) : null}
              <div
                className="composer-box"
                style={
                  {
                    '--composer-mode-color': currentModeColor,
                  } as CSSProperties
                }
              >
                <ContextPanel
                  pins={pinned}
                  modeColor={currentModeColor}
                  onRemove={(path) => {
                    dismissedAutoPinsRef.current.add(path);
                    setPinned((prev) => prev.filter((x) => x.path !== path));
                  }}
                  onClear={() => {
                    for (const pin of pinned) {
                      dismissedAutoPinsRef.current.add(pin.path);
                    }
                    setPinned([]);
                  }}
                  onPick={() => postToHost({ type: 'pickContextPath' })}
                  onKeep={(path) => {
                    dismissedAutoPinsRef.current.delete(path);
                    setPinned((prev) =>
                      prev.map((p) =>
                        p.path === path ? { ...p, source: 'user' } : p,
                      ),
                    );
                  }}
                />
                {pinnedSkillIds.length > 0 ? (
                  <div className="skill-pin-row">
                    {pinnedSkillIds.map((skillId) => (
                      <span key={skillId} className="skill-pin-chip mono">
                        @skill:{skillId}
                        <button
                          type="button"
                          aria-label={`Remove skill ${skillId}`}
                          onClick={() =>
                            setPinnedSkillIds((prev) =>
                              prev.filter((id) => id !== skillId),
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                {suggestOpen ? (
                  <div className="suggest-pop" role="listbox">
                    {suggestLoading ? (
                      <div className="suggest-item suggest-item--loading">
                        <span className="mono">
                          {suggestKind === 'skill'
                            ? 'Loading skills…'
                            : 'Loading files…'}
                        </span>
                      </div>
                    ) : null}
                    {suggestKind === 'skill' ? (
                      <>
                        {!suggestLoading && filteredSkillSuggestions.length === 0 ? (
                          <div className="suggest-item suggest-item--loading">
                            <span className="mono">No matching skills</span>
                          </div>
                        ) : null}
                        {!suggestLoading
                          ? filteredSkillSuggestions.map((item, i) => (
                              <button
                                key={item.id}
                                type="button"
                                className={`suggest-item ${i === activeSuggest ? 'active' : ''}`}
                                onClick={() => selectSkill(item.id)}
                              >
                                <span className="mono">@skill:{item.id}</span>
                                <span className="suggest-kind">{item.name}</span>
                              </button>
                            ))
                          : null}
                      </>
                    ) : (
                      <>
                        {!suggestLoading && suggestions.length === 0 ? (
                          <div className="suggest-item suggest-item--loading">
                            <span className="mono">No matching files</span>
                          </div>
                        ) : null}
                        {!suggestLoading ? suggestions.map((s, i) => (
                          <button
                            key={s.path}
                            type="button"
                            className={`suggest-item ${i === activeSuggest ? 'active' : ''}`}
                            onClick={() => insertMention(s.path)}
                          >
                            <span className="mono">@{s.path}</span>
                            <span className="suggest-kind">{s.kind}</span>
                          </button>
                        )) : null}
                      </>
                    )}
                  </div>
                ) : null}
                <textarea
                  ref={promptTextareaRef}
                  rows={1}
                  value={prompt}
                  placeholder="Message Mitii… @ files, / skills"
                  onChange={(e) => onPromptChange(e.target.value)}
                  onKeyDown={(e) => {
                    const activeSuggestions =
                      suggestKind === 'skill'
                        ? filteredSkillSuggestions
                        : suggestions;
                    if (suggestOpen && activeSuggestions.length) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setActiveSuggest(
                          (i) => (i + 1) % activeSuggestions.length,
                        );
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setActiveSuggest(
                          (i) =>
                            (i - 1 + activeSuggestions.length) %
                            activeSuggestions.length,
                        );
                        return;
                      }
                      if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        if (suggestKind === 'skill') {
                          selectSkill(
                            filteredSkillSuggestions[activeSuggest]!.id,
                          );
                        } else {
                          insertMention(suggestions[activeSuggest]!.path);
                        }
                        return;
                      }
                      if (e.key === 'Escape') {
                        setSuggestOpen(false);
                        return;
                      }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <div className="composer-footer">
                  <div className="composer-dropdown-row">
                    <ComposerControls
                      mode={mode}
                      approvalMode={approvalMode}
                      thoroughness={thoroughness}
                      intensityCustom={
                        ui.intensityOverrides === true &&
                        inferThoroughness(depth, effort) === undefined
                      }
                      onModeChange={changeMode}
                      onApprovalModeChange={changeApprovalMode}
                      onThoroughnessChange={changeThoroughness}
                    />
                  </div>
                  <div className="composer-utility-row">
                    <div className="composer-left">
                      <div className="composer-meta-group">
                        <TokenMeter usage={tokenUsage} placement="above" />
                        <ModelQuickSelect
                          label={selectedModelLabel}
                          value={provider.model}
                          custom={selectedModelIsCustom}
                          options={modelOptions}
                          onSelect={(model) => {
                            setCustomModel(false);
                            saveModel(model);
                          }}
                          onCustomMode={() => setCustomModel(true)}
                          onDraftChange={(model) =>
                            updateProvider((p) => ({ ...p, model }))
                          }
                          onCommitCustom={() => {
                            const model = providerRef.current.model.trim();
                            if (model) saveModel(model);
                          }}
                        />
                      </div>
                    </div>
                    <div className="composer-actions">
                      <IconButton
                        label="Attach skill"
                        variant="ghost"
                        className="icon-btn--slash"
                        active={suggestOpen && suggestKind === 'skill'}
                        disabled={pinnedSkillIds.length >= 3}
                        onClick={openSkillPicker}
                      >
                        <IconSlash />
                      </IconButton>
                      <IconButton
                        label="Copy last response"
                        onClick={() =>
                          postToHost({ type: 'copyLastResponse' })
                        }
                      >
                        <IconCopy />
                      </IconButton>
                      {running ? (
                        <IconButton
                          label="Stop"
                          className="icon-btn--danger"
                          onClick={() => postToHost({ type: 'cancel' })}
                        >
                          <IconStop />
                        </IconButton>
                      ) : (
                        <IconButton
                          label="Send"
                          className="icon-btn--mode"
                          style={
                            {
                              '--composer-control-color': currentModeColor,
                            } as CSSProperties
                          }
                          onClick={send}
                          disabled={!prompt.trim()}
                        >
                          <IconSend />
                        </IconButton>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      ) : null}

      {nav === 'history' ? (
        <HistoryPanel
          threads={history}
          activeThreadId={activeThreadId}
          onOpen={(id) => postToHost({ type: 'openChatThread', id })}
          onDelete={(id) => postToHost({ type: 'deleteChatThread', id })}
          onClear={() => postToHost({ type: 'clearChatHistory' })}
        />
      ) : null}

      {nav === 'settings' ? (
        <SettingsErrorBoundary
          onReset={() => {
            setSettingsTab('model');
            navigate('settings', 'model');
          }}
        >
        <SettingsPanel
          tab={settingsTab}
          onTabChange={(tab) => {
            setSettingsTab(tab);
            navigate('settings', tab);
          }}
          workspace={workspace}
          overrideDraft={overrideDraft}
          onOverrideDraftChange={setOverrideDraft}
          onClearOverride={() => {
            setOverrideDraft('');
          }}
          onOpenFolder={() => postToHost({ type: 'openFolder' })}
          profiles={profiles}
          activeProfileId={activeProfileId}
          onActiveProfileChange={switchProfile}
          onCreateProfile={createProfile}
          provider={provider}
          onProviderChange={handleProviderChange}
          onProviderTypeChange={onProviderTypeChange}
          onSetApiKey={() => postToHost({ type: 'settings.setApiKey' })}
          onClearApiKey={() => postToHost({ type: 'settings.clearApiKey' })}
          onTestConnection={testConnection}
          testingConnection={testingConnection}
          connectionMessage={connectionMessage}
          customModel={customModel}
          onCustomModelChange={setCustomModel}
          modelOptions={modelOptions}
          ui={ui}
          onSaveUi={updateUiDraft}
          mcp={mcp}
          mcpStore={mcpStore}
          mcpRuntimeStatus={mcpRuntimeStatus}
          onMcpChange={setMcp}
          index={index}
          onReindex={() => postToHost({ type: 'index.reindex' })}
          onRefreshIndex={() => postToHost({ type: 'index.refresh' })}
          onMaximumIndexFilesChange={(value) => {
            const maximumIndexFiles = Math.max(
              0,
              Math.min(240000, Math.floor(value)),
            );
            indexRef.current = {
              ...indexRef.current,
              maximumIndexFiles,
            };
            setIndex((current) => ({
              ...current,
              maximumIndexFiles,
            }));
          }}
          onEmbeddingSourceChange={(source: SemanticIndexSource) => {
            setIndex((current) => ({
              ...current,
              embeddingSource: source,
              embeddingEnabled: source !== 'disabled',
            }));
            postToHost({ type: 'settings.set', semanticIndex: { source } });
          }}
          memories={memories}
          onAddMemory={(text) => postToHost({ type: 'addMemory', text })}
          onDeleteMemory={(id) => postToHost({ type: 'deleteMemory', id })}
          onClearMemory={() => postToHost({ type: 'clearMemory' })}
          checkpoints={checkpoints}
          onRestoreCheckpoint={(id) =>
            postToHost({ type: 'restoreCheckpoint', id })
          }
          onDeleteCheckpoint={(id) =>
            postToHost({ type: 'deleteCheckpoint', id })
          }
          onClearCheckpoints={() =>
            postToHost({ type: 'clearCheckpoints' })
          }
          onToggleContext={(source, enabled) => {
            updateUiDraft({ contextToggles: { [source]: enabled } });
          }}
          onSaveAll={saveAllSettings}
          onResetTokenBudget={() =>
            postToHost({ type: 'settings.resetTokenBudget' })
          }
          onResetLoopPolicy={() =>
            postToHost({ type: 'settings.resetLoopPolicy' })
          }
          saving={settingsSaving}
        />
        </SettingsErrorBoundary>
      ) : null}

      {nav === 'automations' ? (
        <AutomationsPanel
          specs={automationSpecs}
          runs={automationRuns}
          loading={automationLoading}
          error={automationError}
          onRefresh={requestAutomations}
        />
      ) : null}
    </div>
  );
}
