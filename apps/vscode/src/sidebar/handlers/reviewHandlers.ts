import { buildFixReviewFindingsAsk } from '@mitii/host';
import { resolveRunIntensity } from '@mitii/ui-core';

import type {
  UiSettingsSnapshot,
  WebviewToHostMessage,
} from '../../protocol.js';
import { reviewFindingKey } from '../../review/reviewFindingsPresenter.js';
import type { SidebarContext } from '../context.js';
import type { AskMessage } from '../runFinalize.js';

export interface FixFindingsDeps {
  readUi: () => UiSettingsSnapshot;
  runAsk: (message: AskMessage) => Promise<void>;
}

/**
 * Host recipe: Agent-fix with `fix-review-findings`.
 * Does not open diff previews — keeps the chat flow focused.
 */
export async function handleFixReviewFindings(
  ctx: SidebarContext,
  message: Extract<WebviewToHostMessage, { type: 'fixReviewFindings' }>,
  deps: FixFindingsDeps,
): Promise<void> {
  const stored = ctx.host.reviewFindings.getFindings();
  const open = stored.filter((f) => f.status !== 'fixed');
  if (open.length === 0) {
    void ctx.vs.window.showWarningMessage(
      'Mitii: No open review findings to fix. Run Review first.',
    );
    return;
  }

  const selected =
    message.indices && message.indices.length > 0
      ? message.indices
          .map((index) => stored[index])
          .filter(
            (finding): finding is NonNullable<typeof finding> =>
              Boolean(finding) && finding.status !== 'fixed',
          )
      : [...open];

  if (selected.length === 0) {
    void ctx.vs.window.showWarningMessage(
      'Mitii: Selected review findings are no longer available.',
    );
    return;
  }

  let ask;
  try {
    ask = buildFixReviewFindingsAsk({
      findings: selected,
      single: selected.length === 1,
    });
  } catch (error) {
    ctx.post({
      type: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Could not build fix-review-findings ask.',
    });
    return;
  }

  ctx.session.pendingFixFindingKeys = selected.map((f) => reviewFindingKey(f));

  const ui = deps.readUi();
  const agentDefaults = ui.modeDefaults.agent;
  const intensity = resolveRunIntensity({
    intensityOverrides: ui.intensityOverrides === true,
    thoroughness: agentDefaults.thoroughness,
    depth: agentDefaults.depth ?? ui.depth,
    effort: ui.effort,
  });

  await deps.runAsk({
    type: 'ask',
    prompt: ask.prompt,
    mode: 'agent',
    depth: intensity.depth,
    effort: intensity.effort,
    approvalMode: agentDefaults.approvalMode ?? ui.approvalMode,
    pinnedPaths: ask.pinnedPaths,
    requiredSkillIds: ask.requiredSkillIds,
  });
}
