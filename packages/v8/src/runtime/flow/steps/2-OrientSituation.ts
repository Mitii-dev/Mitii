import {
  situationPackSchema,
  type SituationPack,
} from "../../contracts/orient/SituationPack";
import {
  buildScopeVerdict,
  extractFocusPaths,
  extractIntentCues,
} from "../../helpers/orient";
import type { StepContext } from "./StepContext";

/**
 * Step 2 — Orient → SituationPack (best-effort).
 * Focus from path-like tokens + host; mutationFence only on explicit edit limits.
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
  const relatedSeeds = impact?.relatedSeeds ?? [];
  const scope = buildScopeVerdict({ message, focusPaths: uniqueFocus });
  const scopeWithSeeds = {
    ...scope,
    relatedSeeds: [...new Set([...scope.relatedSeeds, ...relatedSeeds])],
  };

  const skillIds = ctx.input.requiredSkillIds ?? [];
  const mcpIds =
    ctx.input.requiredMcpServerIds ??
    ctx.input.mcpServerIds ??
    ctx.deps?.mcpServerIds ??
    [];

  const hasHost = Boolean(
    host?.focusedFile ||
      host?.cwd ||
      (host?.dirtyPaths && host.dirtyPaths.length > 0) ||
      host?.selection,
  );
  const hasPins = skillIds.length > 0 || mcpIds.length > 0;
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
    catalog?.projects?.length || catalog?.configPointers?.length,
  );
  const hasImpact = relatedSeeds.length > 0;

  const omissions: Record<string, string> = {};
  if (!hasHost) omissions.host = "not_wired";
  if (!hasPins) omissions.pins = "not_wired";
  if (!hasHistory) omissions.history = "not_provided";
  if (!hasGit) omissions.git = "not_provided";
  if (!hasMemory) omissions.memory = "not_provided";
  if (!hasCatalog) omissions.catalog = "not_provided";
  if (!hasImpact) omissions.impact = "not_provided";

  const reasonCodes = [
    "orient_situation_pack",
    "situation_ready",
    ...(scopeWithSeeds.evidence === "focus_only"
      ? ["scope_focus_not_fence"]
      : []),
    ...(scopeWithSeeds.mutationFence
      ? ["scope_explicit_mutation_fence"]
      : []),
    ...(hasHost ? ["orient_host_snapshot"] : []),
    ...(hasPins ? ["orient_pins_attached"] : []),
    ...(hasHistory ? ["orient_history_digest"] : []),
    ...(hasGit ? ["orient_git_snapshot"] : []),
    ...(hasMemory ? ["orient_memory_facts"] : []),
    ...(hasCatalog ? ["orient_catalog_slice"] : []),
    ...(hasImpact ? ["orient_impact_seeds"] : []),
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
            projectRules: [],
            userSafetyRules: [],
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
          config: {
            pointers: catalog?.configPointers ?? [],
          },
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
      surroundings: [],
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
