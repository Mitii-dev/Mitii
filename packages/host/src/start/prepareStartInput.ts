/**
 * Shared MitiiStartInput assembly for Desktop / VS Code / CLI / ACP.
 *
 * Owns: approval presets, thoroughness → depth/effort, project rules, mode
 * profiles, disk safety merge, database-mode overlay, skill/MCP pin merge.
 * Hosts supply settings-mapped scalars and IDE/environment blocks only.
 */

import {
  mitiiStartInputSchema,
  type AgentMode,
  type MitiiStartInput,
} from '@mitii/sdk';
import { MAX_REQUIRED_MCP_SERVERS } from '@mitii/v8';

import {
  isDatabaseUiMode,
  mapUiModeToAgentMode,
  resolveDatabaseModeStart,
} from '../database-mode/index.js';
import {
  compileModeProfile,
  loadModeProfiles,
  mergeUserSafetyRules,
  resolveModeProfile,
} from '../modes/index.js';
import { loadProjectRules } from '../prompt/projectRules.js';
import {
  loadUserSafetyRules,
  withDefaultProtectedPaths,
} from '../safety/loadUserSafetyRules.js';

import {
  HostStartOptionsError,
  prepareStartInputOptionsSchema,
  type PrepareStartInputOptions,
  type PrepareStartInputResult,
} from './contracts.js';
import { buildRuntimeSituation } from './buildRuntimeSituation.js';
import {
  normalizeApprovalPresetId,
  resolveApprovalPreset,
} from './resolveApprovalPreset.js';
import {
  resolveThoroughness,
  THOROUGHNESS_MAP,
} from './thoroughness.js';

function uniqueIds(
  values: readonly string[] | undefined,
  max: number,
): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  const out = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  return out.length > 0 ? out.slice(0, max) : undefined;
}

/**
 * Build a validated MitiiStartInput with shared rules/modes/safety/approvals.
 */
export async function prepareStartInput(
  options: PrepareStartInputOptions,
): Promise<PrepareStartInputResult> {
  const {
    extraUserSafetyRules,
    conversation,
    approvedPlan,
    approvedPlanStrategy,
    taskList,
    completedPlanStepIds,
    environment,
    budget,
    loopPolicy,
    v8LoopPolicy,
    attachments,
    steering,
    autonomyPreset,
    runtimeSituation: runtimeSituationOverride,
    ...scalarOptions
  } = options;
  const parsed = prepareStartInputOptionsSchema.safeParse(scalarOptions);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HostStartOptionsError(
      'invalid_prepare_start_input',
      `prepareStartInput: ${issue?.path.join('.') || 'options'}: ${issue?.message ?? 'invalid'}`,
    );
  }

  const input = parsed.data;
  const workspaceRoot = input.workspaceRoot?.trim() || undefined;
  const uiMode = input.uiMode ?? 'ask';
  const approvalPresetId = normalizeApprovalPresetId(input.approvalPreset);
  const policy = resolveApprovalPreset(input.approvalPreset);
  const thoroughnessExplicit = input.thoroughness != null;
  const thoroughness = resolveThoroughness(input.thoroughness);
  const intensity = THOROUGHNESS_MAP[thoroughness];

  const loadDiskRules =
    input.loadDiskProjectRules ?? Boolean(workspaceRoot);
  const loadModes = input.loadModeProfiles ?? Boolean(workspaceRoot);
  const userSafetyMode = input.userSafety ?? 'disk';

  if (input.profileOverride && !workspaceRoot) {
    throw new HostStartOptionsError(
      'unknown_mode_profile',
      `prepareStartInput: profileOverride "${input.profileOverride}" requires workspaceRoot`,
    );
  }

  const diskRules =
    loadDiskRules && workspaceRoot
      ? await loadProjectRules({
          workspaceRoot,
          maxRuleChars: input.projectRulesBudget?.maxRuleChars,
          maxTotalChars: input.projectRulesBudget?.maxTotalChars,
        })
      : [];

  let activeProfile =
    loadModes && workspaceRoot
      ? loadModeProfiles(workspaceRoot).active
      : undefined;
  if (input.profileOverride && workspaceRoot) {
    const override = resolveModeProfile(workspaceRoot, input.profileOverride);
    if (!override) {
      throw new HostStartOptionsError(
        'unknown_mode_profile',
        `prepareStartInput: unknown mode profile "${input.profileOverride}"`,
      );
    }
    activeProfile = override;
  }

  const databaseOverlay =
    workspaceRoot && isDatabaseUiMode(uiMode)
      ? resolveDatabaseModeStart({
          workspaceRoot,
          preferredServerIds: input.requiredMcpServerIds,
          dbAccess: input.dbAccess,
        })
      : undefined;

  const compiledMode =
    databaseOverlay || !activeProfile
      ? undefined
      : compileModeProfile(activeProfile);

  const mergedProjectRules = [
    ...diskRules,
    ...(compiledMode?.projectRules ?? []),
    ...(databaseOverlay?.startFields.projectRules ?? []),
  ];

  const fileSafety =
    userSafetyMode === 'disk' && workspaceRoot
      ? withDefaultProtectedPaths(loadUserSafetyRules(workspaceRoot))
      : undefined;
  const userSafetyRules = mergeUserSafetyRules(
    fileSafety,
    extraUserSafetyRules,
    compiledMode?.userSafetyRules,
    databaseOverlay?.startFields.userSafetyRules,
  );

  const effectiveMode: AgentMode = databaseOverlay
    ? databaseOverlay.startFields.mode
    : compiledMode
      ? compiledMode.agentMode
      : mapUiModeToAgentMode(uiMode);

  let approvalMode = policy.approvalMode;
  let planApproval = policy.planApproval;
  if (databaseOverlay?.startFields.approvalMode) {
    approvalMode = databaseOverlay.startFields.approvalMode;
  }
  if (input.approvalOverride?.approvalMode) {
    approvalMode = input.approvalOverride.approvalMode;
  }
  if (input.approvalOverride?.planApproval) {
    planApproval = input.approvalOverride.planApproval;
  }

  const mergedRequiredSkillIds = uniqueIds(
    [
      ...(input.requiredSkillIds ?? []),
      ...(databaseOverlay?.startFields.requiredSkillIds ?? []),
    ],
    3,
  );
  const mergedRequiredMcpServerIds =
    databaseOverlay &&
    databaseOverlay.startFields.requiredMcpServerIds.length > 0
      ? [...databaseOverlay.startFields.requiredMcpServerIds]
      : uniqueIds(input.requiredMcpServerIds, MAX_REQUIRED_MCP_SERVERS);

  const explorationDepth =
    input.explorationDepth ??
    (thoroughnessExplicit ? intensity.depth : undefined);
  const effort =
    input.effort ?? (thoroughnessExplicit ? intensity.effort : undefined);

  const windowBudget: NonNullable<MitiiStartInput['windowBudget']> = {};
  if (effort) {
    windowBudget.effort = effort;
  }
  if (input.windowBudgetPolicy) {
    windowBudget.policy = input.windowBudgetPolicy as never;
  }
  if (input.maximumOutputTokens != null) {
    windowBudget.maximumOutputTokens = input.maximumOutputTokens;
  }
  const hasWindowBudget = Object.keys(windowBudget).length > 0;

  const attachSituation =
    input.attachRuntimeSituation ?? Boolean(workspaceRoot);
  const projectRuleIds = mergedProjectRules
    .map((rule) => {
      if (typeof rule === 'string') return undefined;
      if (rule && typeof rule === 'object' && 'id' in rule) {
        const id = (rule as { id?: unknown }).id;
        return typeof id === 'string' && id.trim() ? id.trim() : undefined;
      }
      return undefined;
    })
    .filter((id): id is string => Boolean(id))
    .slice(0, 32);

  let gatheredSituation: MitiiStartInput['runtimeSituation'];
  let gatheredDirty: string[] | undefined;
  if (attachSituation) {
    const built = await buildRuntimeSituation({
      workspaceRoot,
      focusedFile: input.focusedFile,
      cwd: input.cwd ?? workspaceRoot,
      dirtyPaths: input.dirtyPaths,
      diagnostics: input.diagnostics,
      selection: input.selection,
      projectRuleIds,
      skipGather: input.skipRuntimeSituationGather === true,
      skipDiagnostics: input.skipDiagnostics === true,
    });
    gatheredSituation = built.runtimeSituation;
    gatheredDirty = built.dirtyPaths;
  }

  const runtimeSituation = mergeRuntimeSituation(
    gatheredSituation,
    runtimeSituationOverride,
  );

  const startCandidate: MitiiStartInput = {
    prompt: input.prompt,
    mode: effectiveMode,
    approvalMode,
    planApproval,
    ...(explorationDepth ? { explorationDepth } : {}),
    ...(hasWindowBudget ? { windowBudget } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.pinnedPaths && input.pinnedPaths.length > 0
      ? { pinnedPaths: [...input.pinnedPaths] }
      : {}),
    ...(mergedRequiredSkillIds
      ? { requiredSkillIds: mergedRequiredSkillIds }
      : {}),
    ...(mergedRequiredMcpServerIds
      ? { requiredMcpServerIds: mergedRequiredMcpServerIds }
      : {}),
    ...(input.excludedSkillIds && input.excludedSkillIds.length > 0
      ? { excludedSkillIds: [...input.excludedSkillIds] }
      : {}),
    ...(mergedProjectRules.length > 0
      ? { projectRules: [...mergedProjectRules] }
      : {}),
    ...(userSafetyRules.enabled ? { userSafetyRules } : {}),
    ...(conversation && conversation.length > 0
      ? { conversation }
      : {}),
    ...(approvedPlan ? { approvedPlan } : {}),
    ...(approvedPlanStrategy ? { approvedPlanStrategy } : {}),
    ...(taskList ? { taskList } : {}),
    ...(completedPlanStepIds && completedPlanStepIds.length > 0
      ? { completedPlanStepIds }
      : {}),
    ...(environment && environment.length > 0 ? { environment } : {}),
    ...(budget ? { budget } : {}),
    ...(loopPolicy ? { loopPolicy } : {}),
    ...(v8LoopPolicy ? { v8LoopPolicy } : {}),
    ...(input.logVerbosity ? { logVerbosity: input.logVerbosity } : {}),
    ...(input.origin ? { origin: input.origin } : {}),
    ...(autonomyPreset ? { autonomyPreset } : {}),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    ...(steering ? { steering } : {}),
    ...(input.maxWallTimeMs != null
      ? { maxWallTimeMs: input.maxWallTimeMs }
      : {}),
    ...(gatheredDirty && gatheredDirty.length > 0
      ? { dirtyPaths: gatheredDirty }
      : input.dirtyPaths && input.dirtyPaths.length > 0
        ? { dirtyPaths: [...input.dirtyPaths] }
        : {}),
    ...(runtimeSituation ? { runtimeSituation } : {}),
  };

  const start = mitiiStartInputSchema.parse(startCandidate);

  return {
    start,
    effectiveMode,
    meta: {
      approvalPreset: approvalPresetId,
      usedDatabaseOverlay: Boolean(databaseOverlay),
      ...(compiledMode
        ? {
            usedModeProfile: compiledMode.slug,
            usedModeProfileName: compiledMode.name,
          }
        : {}),
      projectRulesCount: mergedProjectRules.length,
    },
  };
}

function mergeRuntimeSituation(
  gathered: MitiiStartInput['runtimeSituation'],
  override: MitiiStartInput['runtimeSituation'],
): MitiiStartInput['runtimeSituation'] | undefined {
  if (!gathered && !override) return undefined;
  if (!override) return gathered;
  if (!gathered) return override;
  return {
    ...gathered,
    ...override,
    host: {
      ...(gathered.host ?? {}),
      ...(override.host ?? {}),
      dirtyPaths: [
        ...new Set([
          ...(gathered.host?.dirtyPaths ?? []),
          ...(override.host?.dirtyPaths ?? []),
        ]),
      ].slice(0, 64),
      diagnostics: [
        ...new Set([
          ...(gathered.host?.diagnostics ?? []),
          ...(override.host?.diagnostics ?? []),
        ]),
      ].slice(0, 32),
    },
    git: {
      ...(gathered.git ?? {}),
      ...(override.git ?? {}),
      recentCommits: [
        ...(override.git?.recentCommits ?? gathered.git?.recentCommits ?? []),
      ].slice(0, 16),
    },
    catalog: {
      ...(gathered.catalog ?? {}),
      ...(override.catalog ?? {}),
      projects: (
        override.catalog?.projects ??
        gathered.catalog?.projects ??
        []
      ).slice(0, 64),
      configPointers: [
        ...new Set([
          ...(gathered.catalog?.configPointers ?? []),
          ...(override.catalog?.configPointers ?? []),
        ]),
      ].slice(0, 64),
      relationships: (
        override.catalog?.relationships ??
        gathered.catalog?.relationships ??
        []
      ).slice(0, 128),
    },
    impact: {
      relatedSeeds: [
        ...new Set([
          ...(gathered.impact?.relatedSeeds ?? []),
          ...(override.impact?.relatedSeeds ?? []),
        ]),
      ].slice(0, 64),
    },
    memory: override.memory ?? gathered.memory,
    projectRuleIds: [
      ...new Set([
        ...(gathered.projectRuleIds ?? []),
        ...(override.projectRuleIds ?? []),
      ]),
    ].slice(0, 32),
  };
}
