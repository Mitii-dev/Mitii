import {
  situationPackSchema,
  type SituationPack,
} from "../../contracts/orient/SituationPack";
import {
  buildOrientSurroundings,
  buildScopeVerdict,
  extractFocusPaths,
  extractIntentCues,
  resolveConfigNearFocus,
  resolveRelatedProjects,
  resolveWorkRoot,
} from "../../helpers/orient";
import type { StepContext } from "./StepContext";

/**
 * Step 2 — Orient → SituationPack (best-effort).
 * Focus from path-like tokens + host; mutationFence only on explicit edit limits.
 * workRoot + related packages from catalog; surroundings/config are boosts.
 */
export function orientSituation(ctx: StepContext): SituationPack {
  const message = ctx.input.message;
  const host = ctx.input.host;
  const history = ctx.input.history;
  const git = ctx.input.git;
  const memory = ctx.input.memory;
  const catalog = ctx.input.catalog;
  const impact = ctx.input.impact;

  const focusPaths = [
    ...extractFocusPaths(message),
    ...(host?.focusedFile ? [host.focusedFile] : []),
    ...(host?.selection?.path ? [host.selection.path] : []),
    ...(host?.dirtyPaths ?? []).slice(0, 8),
  ];
  const uniqueFocus = [...new Set(focusPaths.filter((p) => p.length > 0))];
  const intentCues = extractIntentCues(message);
  const workRoot = resolveWorkRoot({
    focusPaths: uniqueFocus,
    projects: catalog?.projects,
  });
  const relatedFromCatalog = resolveRelatedProjects({
    workRoot,
    relationships: catalog?.relationships,
  });
  const relatedSeeds = [
    ...new Set([
      ...(impact?.relatedSeeds ?? []),
      ...relatedFromCatalog,
    ]),
  ].slice(0, 32);
  const surroundings = buildOrientSurroundings({
    focusPaths: uniqueFocus,
    workRoot,
    relatedProjects: relatedFromCatalog,
  });
  const configPointers = resolveConfigNearFocus({
    configPointers: catalog?.configPointers ?? [],
    focusPaths: uniqueFocus,
    workRoot,
  });
  const scope = buildScopeVerdict({
    message,
    focusPaths: uniqueFocus,
    ...(workRoot ? { workRoot } : {}),
    ...(ctx.input.protectedPaths && ctx.input.protectedPaths.length > 0
      ? { protectedPaths: ctx.input.protectedPaths }
      : {}),
  });
  const scopeWithSeeds = {
    ...scope,
    relatedSeeds: [...new Set([...scope.relatedSeeds, ...relatedSeeds])],
  };

  const skillIds = ctx.input.requiredSkillIds ?? [];
  const mcpIds = [
    ...new Set([
      ...(ctx.input.requiredMcpServerIds ?? []),
      ...(ctx.input.mcpServerIds ?? []),
      ...(ctx.deps?.mcpServerIds ?? []),
      ...(ctx.input.mcpAttachments?.map((a) => a.serverId) ?? []),
    ]),
  ];

  const hasHost = Boolean(
    host?.focusedFile ||
      host?.cwd ||
      (host?.dirtyPaths && host.dirtyPaths.length > 0) ||
      host?.selection ||
      (host?.diagnostics && host.diagnostics.length > 0),
  );
  const projectRuleIds = [
    ...new Set([
      ...(ctx.input.projectRuleIds ?? []),
      ...(ctx.input.projectRuleAttachments?.map((a) => a.id) ?? []),
    ]),
  ];
  const userSafetyRuleIds = [
    ...new Set([
      ...(ctx.input.userSafetyRuleIds ?? []),
      ...(ctx.input.userSafetyRuleAttachments?.map((a) => a.id) ?? []),
    ]),
  ];
  const mcpAttachments = ctx.input.mcpAttachments;
  const projectRuleAttachments = ctx.input.projectRuleAttachments;
  const userSafetyRuleAttachments = ctx.input.userSafetyRuleAttachments;
  const hasStructuredPins = Boolean(
    mcpAttachments?.length ||
      projectRuleAttachments?.length ||
      userSafetyRuleAttachments?.length,
  );
  const hasPins =
    skillIds.length > 0 ||
    mcpIds.length > 0 ||
    projectRuleIds.length > 0 ||
    userSafetyRuleIds.length > 0 ||
    hasStructuredPins;
  const hasHistory = Boolean(
    history?.digest ||
      history?.priorRoute ||
      typeof history?.compactedTurns === "number",
  );
  const hasGit = Boolean(
    git?.branch || typeof git?.dirty === "boolean" || git?.recentCommits?.length,
  );
  const hasMemory = typeof memory?.factCount === "number";
  const hasCatalog = Boolean(
    catalog?.projects?.length ||
      catalog?.configPointers?.length ||
      catalog?.relationships?.length,
  );
  const hasImpact = relatedSeeds.length > 0;
  const hasSurroundings = surroundings.length > 0;
  const hasConfig = configPointers.length > 0;
  const hasRelationships = Boolean(catalog?.relationships?.length);

  const omissions: Record<string, string> = {};
  if (!hasHost) omissions.host = "not_wired";
  if (!hasPins) omissions.pins = "not_wired";
  if (!hasHistory) omissions.history = "not_provided";
  if (!hasGit) omissions.git = "not_provided";
  if (!hasMemory) omissions.memory = "not_provided";
  if (!hasCatalog) omissions.catalog = "not_provided";
  if (!hasImpact) omissions.impact = "not_provided";
  if (!hasSurroundings) omissions.navigation = "not_provided";
  if (!hasConfig) omissions.config = "not_provided";

  const reasonCodes = [
    "orient_situation_pack",
    "situation_ready",
    ...(scopeWithSeeds.evidence === "focus_only"
      ? ["scope_focus_not_fence"]
      : []),
    ...(scopeWithSeeds.mutationFence
      ? ["scope_explicit_mutation_fence"]
      : []),
    ...(scopeWithSeeds.protectedPaths &&
    scopeWithSeeds.protectedPaths.length > 0
      ? ["scope_protected_paths"]
      : []),
    ...(workRoot ? ["orient_work_root"] : []),
    ...(hasHost ? ["orient_host_snapshot"] : []),
    ...(hasPins ? ["orient_pins_attached"] : []),
    ...(hasStructuredPins ? ["orient_mcp_rules_structured"] : []),
    ...(hasHistory ? ["orient_history_digest"] : []),
    ...(hasGit ? ["orient_git_snapshot"] : []),
    ...(hasMemory ? ["orient_memory_facts"] : []),
    ...(hasCatalog ? ["orient_catalog_slice"] : []),
    ...(hasRelationships ? ["orient_catalog_relationships"] : []),
    ...(relatedFromCatalog.length > 0 ? ["orient_related_projects"] : []),
    ...(hasImpact ? ["orient_impact_seeds"] : []),
    ...(hasSurroundings ? ["orient_surroundings"] : []),
    ...(hasConfig ? ["orient_config_near_focus"] : []),
    ...(host?.diagnostics && host.diagnostics.length > 0
      ? ["orient_host_diagnostics"]
      : []),
  ];

  const pack = situationPackSchema.parse({
    schemaVersion: 1,
    request: {
      text: message,
      mode: ctx.mode,
      intentCues,
    },
    requestText: message,
    mode: ctx.mode,
    ...(hasHost
      ? {
          host: {
            focusedFile: host?.focusedFile,
            cwd: host?.cwd,
            dirtyPaths: host?.dirtyPaths ?? [],
            diagnostics: host?.diagnostics ?? [],
            selection: host?.selection,
          },
        }
      : {}),
    ...(hasPins
      ? {
          pins: {
            skillIds,
            mcpIds,
            projectRules: projectRuleIds,
            userSafetyRules: userSafetyRuleIds,
            ...(mcpAttachments && mcpAttachments.length > 0
              ? { mcpAttachments }
              : {}),
            ...(projectRuleAttachments && projectRuleAttachments.length > 0
              ? { projectRuleAttachments }
              : {}),
            ...(userSafetyRuleAttachments &&
            userSafetyRuleAttachments.length > 0
              ? { userSafetyRuleAttachments }
              : {}),
          },
        }
      : {}),
    ...(hasHistory
      ? {
          history: {
            compactedTurns: history?.compactedTurns,
            digest: history?.digest,
            priorRoute: history?.priorRoute,
            priorTaskBand: history?.priorTaskBand,
          },
        }
      : {}),
    ...(hasGit
      ? {
          git: {
            branch: git?.branch,
            dirty: git?.dirty,
            recentCommits: git?.recentCommits ?? [],
          },
        }
      : {}),
    ...(hasMemory
      ? {
          memory: {
            factCount: memory?.factCount ?? 0,
          },
        }
      : {}),
    ...(hasCatalog
      ? {
          projects: catalog?.projects ?? [],
          ...(hasRelationships
            ? { relationships: catalog?.relationships ?? [] }
            : {}),
          ...(hasConfig
            ? {
                config: {
                  pointers: configPointers,
                },
              }
            : catalog?.configPointers?.length
              ? {
                  config: {
                    pointers: catalog.configPointers,
                  },
                }
              : {}),
        }
      : {}),
    ...(hasImpact
      ? {
          impact: {
            relatedSeeds,
          },
        }
      : {}),
    navigation: {
      mentionedPaths: uniqueFocus,
      surroundings,
    },
    scope: scopeWithSeeds,
    budget: {
      windowBand: deriveWindowBand(
        ctx.store.getSlice<{ contextWindowTokens?: number }>("windowPolicy")
          ?.contextWindowTokens,
      ),
    },
    omissions,
    reasonCodes,
  });
  ctx.store.setSlice("situationPack", pack);
  return pack;
}

function deriveWindowBand(tokens: number | undefined): string | undefined {
  if (typeof tokens !== "number") return undefined;
  if (tokens < 40_000) return "compact";
  if (tokens < 100_000) return "standard";
  return "wide";
}
