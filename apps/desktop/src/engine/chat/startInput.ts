/** Build SDK start input from a desktop prompt body. */

import {
  isDatabaseUiMode,
  mapUiModeToAgentMode,
  mergeUserSafetyRules,
  normalizeOllamaModelId,
  resolveDatabaseModeStart,
} from '@mitii/host';
import {
  planArtifactSchema,
  planStrategyDecisionSchema,
  taskListSchema,
  type MitiiStartInput,
} from '@mitii/sdk';
import {
  buildDesktopStartExtras,
  readDesktopSettingsJson,
} from '../startOptions.js';
import {
  getGitStatus,
} from '../git/status.js';
import {
  asStringArray,
  parseConversation,
} from '../http/bodyParsers.js';

export const THOROUGHNESS_MAP = {
  low: { depth: 'quick' as const, effort: 'low' as const },
  medium: { depth: 'auto' as const, effort: 'medium' as const },
  high: { depth: 'deep' as const, effort: 'high' as const },
};

export const APPROVAL_PRESET_MAP = {
  safe: {
    approvalMode: 'every_mutation' as const,
    planApproval: 'policy' as const,
  },
  guided: {
    approvalMode: 'when_required' as const,
    planApproval: 'policy' as const,
  },
  pilot: {
    // Tools stay autonomous; visible/architecture plans still gate so the
    // user can see and approve the plan before mutate (avoids silent hollow run).
    approvalMode: 'never' as const,
    planApproval: 'policy' as const,
  },
  builder: {
    approvalMode: 'when_required' as const,
    planApproval: 'policy' as const,
  },
};

export function resolveApprovalPreset(preset: string | undefined): {
  approvalMode: 'never' | 'when_required' | 'every_mutation';
  planApproval: 'policy' | 'never';
} {
  const key =
    preset === 'safe' ||
    preset === 'guided' ||
    preset === 'pilot' ||
    preset === 'builder'
      ? preset
      : 'guided';
  return APPROVAL_PRESET_MAP[key];
}

export function buildStartInput(
  body: Record<string, unknown>,
  parsed: {
    prompt: string;
    mode?: 'ask' | 'plan' | 'agent' | 'database';
    id?: string;
    model?: string;
    sessionId?: string;
  },
  workspaceRoot: string,
): MitiiStartInput {
  const approvalPreset =
    typeof body.approvalPreset === 'string' ? body.approvalPreset : 'guided';
  const policy = resolveApprovalPreset(approvalPreset);
  const thoroughnessRaw =
    typeof body.thoroughness === 'string' ? body.thoroughness : 'medium';
  const thoroughness =
    thoroughnessRaw === 'low' || thoroughnessRaw === 'high'
      ? thoroughnessRaw
      : 'medium';
  const intensity = THOROUGHNESS_MAP[thoroughness];
  const pinnedPaths = asStringArray(body.pinnedPaths, 32);
  let requiredSkillIds = asStringArray(body.requiredSkillIds, 16);
  let requiredMcpServerIds = asStringArray(body.requiredMcpServerIds, 16);
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
  const uiMode = parsed.mode ?? 'ask';
  const dbAccessRaw =
    typeof body.dbAccess === 'string' ? body.dbAccess.trim().toLowerCase() : '';
  const dbAccess =
    dbAccessRaw === 'readwrite' ||
    dbAccessRaw === 'read_write' ||
    dbAccessRaw === 'rw'
      ? 'readwrite'
      : 'readonly';

  let agentMode = mapUiModeToAgentMode(uiMode);
  let projectRules: MitiiStartInput['projectRules'];
  let userSafetyRules: MitiiStartInput['userSafetyRules'];
  let approvalMode = policy.approvalMode;
  if (isDatabaseUiMode(uiMode)) {
    const db = resolveDatabaseModeStart({
      workspaceRoot,
      preferredServerIds: requiredMcpServerIds,
      dbAccess,
    });
    agentMode = db.startFields.mode;
    requiredSkillIds = [
      ...new Set([
        ...(requiredSkillIds ?? []),
        ...db.startFields.requiredSkillIds,
      ]),
    ].slice(0, 3);
    requiredMcpServerIds =
      db.startFields.requiredMcpServerIds.length > 0
        ? db.startFields.requiredMcpServerIds
        : undefined;
    projectRules = db.startFields.projectRules;
    userSafetyRules = mergeUserSafetyRules(
      undefined,
      db.startFields.userSafetyRules,
    );
    if (db.startFields.approvalMode) {
      approvalMode = db.startFields.approvalMode;
    }
  }

  return {
    prompt: parsed.prompt,
    mode: agentMode,
    workspaceRoot,
    approvalMode,
    planApproval: policy.planApproval,
    explorationDepth: intensity.depth,
    windowBudget: {
      effort: intensity.effort,
      ...(extras.windowBudget?.policy
        ? { policy: extras.windowBudget.policy }
        : {}),
      ...(extras.windowBudget?.maximumOutputTokens != null
        ? { maximumOutputTokens: extras.windowBudget.maximumOutputTokens }
        : {}),
    },
    ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
    ...(model ? { model } : {}),
    ...(pinnedPaths ? { pinnedPaths } : {}),
    ...(requiredSkillIds ? { requiredSkillIds } : {}),
    ...(requiredMcpServerIds ? { requiredMcpServerIds } : {}),
    ...(projectRules ? { projectRules } : {}),
    ...(userSafetyRules?.enabled ? { userSafetyRules } : {}),
    ...(conversation ? { conversation } : {}),
    ...(approvedPlan ? { approvedPlan } : {}),
    ...(approvedPlanStrategy ? { approvedPlanStrategy } : {}),
    ...(taskList ? { taskList } : {}),
    ...(extras.budget ? { budget: extras.budget } : {}),
    ...(extras.loopPolicy ? { loopPolicy: extras.loopPolicy } : {}),
    ...(extras.logVerbosity ? { logVerbosity: extras.logVerbosity } : {}),
  };
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
