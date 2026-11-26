import {
  directionAnalysisInputSchema,
  type DirectionAnalysisInput,
} from "../../contracts/input/DirectionAnalysisInput";
import {
  taskDirectionAssessmentSchema,
  type TaskDirectionAssessment,
} from "../../contracts/output/TaskDirectionAssessment";

/**
 * Direction ballot from SituationPack-shaped input (§5).
 * Temporary deterministic assess until Officer LLM path owns this (S2-NO-HEURISTICS).
 * Authority remains Decision Policy.
 */
export function assessDirection(
  raw: DirectionAnalysisInput,
): TaskDirectionAssessment {
  const input = directionAnalysisInputSchema.parse(raw);
  const text = input.userCommand.toLowerCase();
  const cues = input.intentCues;

  let primaryTaskIntent: TaskDirectionAssessment["primaryTaskIntent"] =
    "question";
  let planningHint: TaskDirectionAssessment["planningHint"] = "none";
  let risk: TaskDirectionAssessment["risk"] = "low";
  let difficulty: TaskDirectionAssessment["difficulty"] = "simple";
  let interactionIntent: TaskDirectionAssessment["interactionIntent"] =
    "question";
  let askUserSuggested = false;
  const assumptionsMade: string[] = [];
  const reasonCodes: string[] = ["assess_direction_deterministic"];

  if (cues?.pastedErrorOrStack || /\b(fix|bug|error|crash|stack)\b/.test(text)) {
    primaryTaskIntent = cues?.pastedErrorOrStack ? "diagnose" : "bugfix";
    interactionIntent = "act";
    difficulty = "moderate";
  } else if (/\b(refactor|restructure)\b/.test(text)) {
    primaryTaskIntent = "refactor";
    planningHint = "medium";
    risk = "medium";
    interactionIntent = "act";
    difficulty = "moderate";
  } else if (/\b(plan|design)\b/.test(text)) {
    primaryTaskIntent = "feature";
    planningHint = "long";
    interactionIntent = "plan";
    difficulty = "complex";
  } else if (
    cues?.createAsk ||
    /\b(implement|add|create|build|upgrade|scaffold)\b/.test(text)
  ) {
    primaryTaskIntent = "feature";
    planningHint = "short";
    interactionIntent = "act";
  } else if (/\b(diagnos|why|root cause)\b/.test(text)) {
    primaryTaskIntent = "diagnose";
    interactionIntent = "act";
  } else if (/\b(test|spec)\b/.test(text)) {
    primaryTaskIntent = "test";
    interactionIntent = "act";
  } else if (/\b(review|audit)\b/.test(text)) {
    primaryTaskIntent = "review";
    interactionIntent = "question";
  } else if (cues?.readOnlyAsk) {
    primaryTaskIntent = "question";
    interactionIntent = "question";
    assumptionsMade.push("read_only_constraint");
  }

  if (
    text.trim().length < 8 ||
    /^(fix it|do it|help)\b/.test(text.trim())
  ) {
    askUserSuggested = true;
    primaryTaskIntent = "unclear";
    interactionIntent = "help";
    reasonCodes.push("assess_vague_command");
  }

  // Anti-nag: trivial + low risk → prefer assumptions over ask (DP still clamps).
  if (
    !askUserSuggested &&
    (difficulty === "trivial" || difficulty === "simple") &&
    risk === "low" &&
    input.turnKind !== "new"
  ) {
    assumptionsMade.push("continue_turn_assume_prior_context");
  }

  const focus = input.situationSummary.focusPaths;
  const filesToRead = [
    ...focus.map((path) => ({ path, priority: "high" as const })),
    ...input.candidateFiles.map((f) => ({
      path: f.path,
      priority: "medium" as const,
    })),
  ].slice(0, 12);

  const taskBand =
    difficulty === "very_complex" || difficulty === "complex"
      ? "large"
      : difficulty === "moderate" || planningHint === "medium"
        ? "medium"
        : "small";

  const scope =
    focus.length === 0
      ? "unknown"
      : focus.length === 1
        ? "single_location"
        : focus.length <= 3
          ? "multi_file"
          : "package";

  return taskDirectionAssessmentSchema.parse({
    schemaVersion: 1,
    interactionIntent,
    primaryTaskIntent,
    difficulty,
    taskBand,
    risk,
    scope,
    planningHint,
    filesToRead,
    clarityConfidence: askUserSuggested ? "low" : "medium",
    askUserSuggested,
    askUser: askUserSuggested,
    assumptionsMade,
    skillsAndMcp: {
      matchedSkillIds: input.attachedSkills.map((s) => s.id),
      matchedMcpIds: input.attachedMcp.map((m) => m.serverId),
    },
    reasonCodes,
  });
}

/** Build DirectionAnalysisInput from a SituationPack-like bag (runtime glue). */
export function directionInputFromSituationPack(pack: {
  request?: {
    text?: string;
    mode?: "ask" | "plan" | "agent";
    intentCues?: DirectionAnalysisInput["intentCues"];
  };
  requestText?: string;
  mode?: "ask" | "plan" | "agent";
  scope?: {
    focusPaths?: string[];
    workRoot?: string;
    readHint?: "workspace" | "package" | "folder";
    mutationFence?: string[];
    evidence?: "focus_only" | "explicit_limit" | "safety_rule" | "unclear";
  };
  host?: { dirtyPaths?: string[] };
  pins?: { skillIds?: string[]; mcpIds?: string[] };
  budget?: { windowBand?: string };
  history?: { priorRoute?: string; priorTaskBand?: string; digest?: string };
  navigation?: { mentionedPaths?: string[] };
}): DirectionAnalysisInput {
  const text = pack.request?.text ?? pack.requestText ?? "";
  return directionAnalysisInputSchema.parse({
    schemaVersion: 1,
    userCommand: text,
    mode: pack.request?.mode ?? pack.mode ?? "agent",
    situationSummary: {
      focusPaths: pack.scope?.focusPaths ?? pack.navigation?.mentionedPaths ?? [],
      workRoot: pack.scope?.workRoot,
      readHint: pack.scope?.readHint,
      mutationFence: pack.scope?.mutationFence,
      scopeEvidence: pack.scope?.evidence,
      dirtyPaths: pack.host?.dirtyPaths ?? [],
      windowBand: pack.budget?.windowBand,
    },
    intentCues: pack.request?.intentCues,
    historyDigest: pack.history
      ? {
          priorRoute: pack.history.priorRoute,
          priorTaskBand: pack.history.priorTaskBand,
          digest: pack.history.digest,
        }
      : undefined,
    attachedSkills: (pack.pins?.skillIds ?? []).map((id) => ({
      id,
      required: true,
    })),
    attachedMcp: (pack.pins?.mcpIds ?? []).map((serverId) => ({
      serverId,
      required: true,
    })),
    candidateFiles: (pack.scope?.focusPaths ?? [])
      .filter((p) => /\.[\w.+-]+$/.test(p))
      .map((path) => ({ path, kind: "file" })),
  });
}
