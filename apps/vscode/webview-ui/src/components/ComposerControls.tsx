import type { ComponentProps } from 'react';
import {
  ComposerControls as SharedComposerControls,
  DEFAULT_MODE_OPTIONS,
  type ComposerMode,
} from '@mitii/ui-react';

import { normalizeApproval, type ApprovalUiMode } from '../approvalPresets';
import type { AgentUiMode, AgentUiThoroughness } from '../protocol';
import {
  IconAgent,
  IconApproveForMe,
  IconAsk,
  IconAskApproval,
  IconCheck,
  IconDepthDeep,
  IconEffortHigh,
  IconEffortLow,
  IconEffortMedium,
  IconFullAccess,
  IconPlan,
} from './Icons';

export const MODE_HINT: Record<AgentUiMode, string> = {
  ask: 'Explore and answer — read-only.',
  plan: 'Analyze and propose a structured plan.',
  agent: 'Implement changes with controlled execution.',
  review: 'Git working-tree review via the Review button — not a chat mode.',
  database: 'Query connected databases via MCP — read-only.',
};

/** The webview database mode is read-only; the shared catalog describes the Desktop read/write variant. */
const MODE_OPTIONS = DEFAULT_MODE_OPTIONS.map((option) =>
  option.id === 'database'
    ? { ...option, description: 'Query connected DBs via MCP — read-only' }
    : option,
);

const ICONS: NonNullable<ComponentProps<typeof SharedComposerControls>['icons']> = {
  ask: <IconAsk />,
  plan: <IconPlan />,
  agent: <IconAgent />,
  database: <IconAsk />,
  safe: <IconAskApproval />,
  guided: <IconApproveForMe />,
  pilot: <IconFullAccess />,
  low: <IconEffortLow />,
  medium: <IconEffortMedium />,
  high: <IconEffortHigh />,
  custom: <IconDepthDeep />,
};

interface ComposerControlsProps {
  mode: AgentUiMode;
  /** Raw host value; legacy ids are normalized before display. */
  approvalMode: string;
  thoroughness: AgentUiThoroughness;
  /** When true, the thoroughness picker shows Custom until the user picks a level. */
  intensityCustom?: boolean;
  onModeChange: (mode: AgentUiMode) => void;
  onApprovalModeChange: (mode: ApprovalUiMode) => void;
  onThoroughnessChange: (thoroughness: AgentUiThoroughness) => void;
}

/** Webview binding for the shared composer pickers: icons, read-only database copy, centred menus. */
export function ComposerControls({
  mode,
  approvalMode,
  thoroughness,
  intensityCustom,
  onModeChange,
  onApprovalModeChange,
  onThoroughnessChange,
}: ComposerControlsProps) {
  // `review` is a Review-button state, not a chat mode; show it as Ask.
  const composerMode: ComposerMode =
    mode === 'plan' || mode === 'agent' || mode === 'database' ? mode : 'ask';
  return (
    <SharedComposerControls
      mode={composerMode}
      approvalMode={normalizeApproval(approvalMode)}
      thoroughness={thoroughness}
      intensityCustom={intensityCustom}
      onModeChange={onModeChange}
      onApprovalModeChange={onApprovalModeChange}
      onThoroughnessChange={onThoroughnessChange}
      icons={ICONS}
      checkIcon={<IconCheck />}
      modeOptions={MODE_OPTIONS}
      menuAlign="center"
    />
  );
}
