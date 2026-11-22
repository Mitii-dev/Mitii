/** Build SDK start input from a desktop prompt body via host prepareStartInput. */

import {
  normalizeOllamaModelId,
  prepareStartInput,
  resolveApprovalPreset,
  resolveThoroughness,
  THOROUGHNESS_MAP,
  type HostUiMode,
} from '@mitii/host';
import type { MitiiStartInput } from '@mitii/sdk';
import {
  planArtifactSchema,
  planStrategyDecisionSchema,
  taskListSchema,
} from '@mitii/sdk';
import {
  buildDesktopStartExtras,
  readDesktopSettingsJson,
} from '../startOptions.js';
import { getGitStatus } from '../git/status.js';
import {
  asStringArray,
  parseConversation,
} from '../http/bodyParsers.js';

export { resolveApprovalPreset, THOROUGHNESS_MAP };

export async function buildStartInput(
  body: Record<string, unknown>,
  parsed: {
    prompt: string;
    mode?: 'ask' | 'plan' | 'agent' | 'database';
    id?: string;
    model?: string;
    sessionId?: string;
  },
  workspaceRoot: string,
): Promise<MitiiStartInput> {
  const approvalPreset =
    typeof body.approvalPreset === 'string' ? body.approvalPreset : 'guided';
  const thoroughness = resolveThoroughness(
    typeof body.thoroughness === 'string' ? body.thoroughness : undefined,
  );
  const pinnedPaths = asStringArray(body.pinnedPaths, 32);
  const requiredSkillIds = asStringArray(body.requiredSkillIds, 16);
  const requiredMcpServerIds = asStringArray(body.requiredMcpServerIds, 16);
  const conversation = parseConversation(body.conversation);
  const approvedPlanParse = planArtifactSchema.safeParse(body.approvedPlan);
  const approvedPlan = approvedPlanParse.success
    ? approvedPlanParse.data
    : undefined;
  const strategyParse = planStrategyDecisionSchema.safeParse(
    body.approvedPlanStrategy,
  );
  const approvedPlanStrategy = strategyParse.success
    ? strategyParse.data
    : undefined;
  const taskListParse = taskListSchema.safeParse(body.taskList);
  const taskList = taskListParse.success ? taskListParse.data : undefined;
  const modelRaw =
    (typeof body.model === 'string' && body.model.trim()
      ? body.model.trim()
      : undefined) ??
    parsed.model ??
    process.env.MITII_MODEL?.trim() ??
    '';
  const model = modelRaw
    ? normalizeOllamaModelId(modelRaw, process.env.MITII_BASE_URL)
    : undefined;

  const extras = buildDesktopStartExtras(process.env);
  const uiMode = (parsed.mode ?? 'ask') as HostUiMode;
  const dbAccessRaw =
    typeof body.dbAccess === 'string' ? body.dbAccess.trim().toLowerCase() : '';
  const dbAccess =
    dbAccessRaw === 'readwrite' ||
    dbAccessRaw === 'read_write' ||
    dbAccessRaw === 'rw'
      ? ('readwrite' as const)
      : ('readonly' as const);

  const { start } = await prepareStartInput({
    prompt: parsed.prompt,
    workspaceRoot,
    uiMode,
    approvalPreset,
    thoroughness,
    dbAccess,
    ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
    ...(model ? { model } : {}),
    ...(pinnedPaths ? { pinnedPaths } : {}),
    ...(requiredSkillIds ? { requiredSkillIds } : {}),
    ...(requiredMcpServerIds ? { requiredMcpServerIds } : {}),
    ...(conversation ? { conversation } : {}),
    ...(approvedPlan ? { approvedPlan } : {}),
    ...(approvedPlanStrategy ? { approvedPlanStrategy } : {}),
    ...(taskList ? { taskList } : {}),
    ...(extras.budget ? { budget: extras.budget } : {}),
    ...(extras.loopPolicy ? { loopPolicy: extras.loopPolicy } : {}),
    ...(extras.v8LoopPolicy ? { v8LoopPolicy: extras.v8LoopPolicy } : {}),
    ...(extras.logVerbosity ? { logVerbosity: extras.logVerbosity } : {}),
    ...(extras.windowBudget?.policy
      ? { windowBudgetPolicy: extras.windowBudget.policy as Record<string, number> }
      : {}),
    ...(extras.windowBudget?.maximumOutputTokens != null
      ? { maximumOutputTokens: extras.windowBudget.maximumOutputTokens }
      : {}),
  });

  return start;
}

/** Optional host context blocks from ui.contextToggles (gitDiff today). */
export async function attachContextEnvironment(
  startInput: MitiiStartInput,
  workspaceRoot: string,
): Promise<MitiiStartInput> {
  const settings = readDesktopSettingsJson(process.env);
  const ui = settings?.ui;
  const toggles =
    ui && typeof ui === 'object' && !Array.isArray(ui)
      ? (ui as Record<string, unknown>).contextToggles
      : undefined;
  const gitDiffOn =
    toggles &&
    typeof toggles === 'object' &&
    !Array.isArray(toggles) &&
    (toggles as Record<string, unknown>).gitDiff === true;
  if (!gitDiffOn) return startInput;

  try {
    const status = await getGitStatus(workspaceRoot);
    if (!status.ok || status.files.length === 0) return startInput;
    const lines = status.files
      .slice(0, 40)
      .map((f) => `${f.status} ${f.path}`);
    const content = [
      status.branch ? `Branch: ${status.branch}` : null,
      status.summary,
      ...lines,
    ]
      .filter(Boolean)
      .join('\n');
    const block = {
      id: 'git-diff',
      title: 'Git working tree',
      content,
      priority: 40,
    };
    return {
      ...startInput,
      environment: [...(startInput.environment ?? []), block],
    };
  } catch {
    return startInput;
  }
}
