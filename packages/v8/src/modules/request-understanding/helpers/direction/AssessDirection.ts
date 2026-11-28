import {
  directionAnalysisInputSchema,
  type DirectionAnalysisInput,
} from "../../contracts/input/DirectionAnalysisInput";
import type { EndingPosture } from "../../contracts/continuity/EndingPosture";
import {
  taskDirectionAssessmentSchema,
  type TaskDirectionAssessment,
} from "../../contracts/output/TaskDirectionAssessment";
import { isContinuationTurnKind } from "../../rules/TurnKindIntentPolicy";

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
  const continuation = isContinuationTurnKind(input.turnKind);

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

  // Knowledge / how-to / brainstorm phrasing wins over verb false positives
  // ("explain how to add…", "what all checks can we newly implement?").
  if (
    /^(?:please\s+)?(?:explain|describe|summarize|summarise|clarify|compare)\b/.test(
      text,
    ) ||
    /^(?:how\s+(?:do|does|did|can|should|would|to)|what\s+(?:is|are|does)|why\s+)/.test(
      text,
    ) ||
    /\bwhat\s+all\b/.test(text) ||
    (/\?\s*$/.test(text.trim()) &&
      /\b(?:what|which)\b/.test(text) &&
      /\b(?:can|could|should)\s+(?:we|i|you)\b/.test(text))
  ) {
    primaryTaskIntent = "question";
    interactionIntent = "question";
  } else if (
    cues?.pastedErrorOrStack ||
    /\b(fix|bug|error|crash|stack)\b/.test(text)
  ) {
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
    /\b(implement(?:ing)?|add|create|build|upgrade|scaffold)\b/.test(text) ||
    /\bstart\s+(?:the\s+)?implement(?:ing|ation)\b/.test(text)
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
  } else if (
    /\b(remove|delete|clear|discard|revert|unstage|clean(?:\s+up)?)\b/.test(
      text,
    ) ||
    /\bgit\s+(?:clean|restore|checkout|reset)\b/.test(text)
  ) {
    // Working-tree / file cleanup is a mutation act, not a knowledge question.
    primaryTaskIntent = "refactor";
    interactionIntent = "act";
  } else if (cues?.readOnlyAsk) {
    primaryTaskIntent = "question";
    interactionIntent = "question";
    assumptionsMade.push("read_only_constraint");
  }

  const trimmed = text.trim();
  const vagueNudge =
    trimmed.length < 8 ||
    /^(?:fix it|do it|help|\?+|go on|continue|and\??|ok|okay|yes|yep)\b/.test(
      trimmed,
    );

  if (vagueNudge) {
    if (continuation) {
      askUserSuggested = false;
      assumptionsMade.push("continue_turn_assume_prior_context");
      const posture = input.historyDigest?.endingPosture;
      const openWork =
        posture === "proposal_ready" ||
        posture === "incomplete" ||
        posture === "awaiting_approval";
      // Open prior work + vague continuation → act; missing posture falls
      // back to agent-as-act so first deploys without stamped continuity still work.
      if (input.mode === "agent" && (openWork || !posture)) {
        primaryTaskIntent = "feature";
        interactionIntent = "act";
        reasonCodes.push(
          openWork
            ? "assess_continuity_open_work_as_act"
            : "assess_agent_continuation_as_act",
        );
      } else {
        primaryTaskIntent = "question";
        interactionIntent = "question";
        reasonCodes.push("assess_continuation_nudge");
      }
    } else {
      askUserSuggested = true;
      primaryTaskIntent = "unclear";
      interactionIntent = "help";
      reasonCodes.push("assess_vague_command");
    }
  }

  // Anti-nag: simple + low risk → prefer assumptions over ask (DP still clamps).
  if (
    !askUserSuggested &&
    difficulty === "simple" &&
    risk === "low" &&
    continuation
  ) {
    if (!assumptionsMade.includes("continue_turn_assume_prior_context")) {
      assumptionsMade.push("continue_turn_assume_prior_context");
    }
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
    difficulty === "complex"
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
  history?: {
    priorRoute?: string;
    priorTaskBand?: string;
    endingPosture?: EndingPosture;
    digest?: string;
  };
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
          endingPosture: pack.history.endingPosture,
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
