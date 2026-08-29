import type { MutationBudget } from "../../../modules/decision-policy";
import type { TaskList } from "../../../modules/task-list";
import {
  WORKING_SET_MARKER,
  serializeWorkingSetChecklistLines,
} from "../../../modules/task-list";

import type { EstablishedFact } from "./extractEstablishedFact";
import { buildMutationBudgetWorkingSetLines } from "./buildMutationBudgetInstruction";

export interface RecoverabilityWorkingSetInput {
  taskList?: TaskList;
  mutationBudget?: MutationBudget;
  preflightDiagnostics?: string;
  establishedFacts?: readonly EstablishedFact[];
  maxEstablishedFactChars?: number;
}

const COMPILER_QUEUE_FACT_ID = "error-queue:compiler";

/**
 * Unified trailing block for live checklist, mutation caps, preflight targets,
 * compiler queue, and established observations. Compaction may drop it; the
 * engine re-upserts before each model call.
 */
export function serializeRecoverabilityWorkingSet(
  params: RecoverabilityWorkingSetInput,
): string | undefined {
  const sections: string[] = [];

  const checklist = serializeWorkingSetChecklistLines(params.taskList);
  if (checklist.length > 0) {
    sections.push("## Checklist", ...checklist);
  } else {
    sections.push(
      "## Checklist",
      "No live checklist yet. If this is a multi-step run, after the first read/diagnose tool turn call update_todos with type=replace. Each title must name a concrete file, failure, or user-visible behavior.",
    );
  }

  const mutationBudget = buildMutationBudgetWorkingSetLines(params.mutationBudget);
  if (mutationBudget) {
    sections.push("## Mutation budget", mutationBudget);
  }

  const preflight = params.preflightDiagnostics?.trim();
  if (preflight) {
    sections.push("## Preflight diagnostics", preflight);
  }

  const facts = params.establishedFacts ?? [];
  const compilerQueue = facts.find((fact) => fact.id === COMPILER_QUEUE_FACT_ID);
  if (compilerQueue) {
    sections.push("## Compiler queue", compilerQueue.content);
  }

  const observations = facts.filter((fact) => fact.id !== COMPILER_QUEUE_FACT_ID);
  const observationLines = formatEstablishedObservationLines(
    observations,
    params.maxEstablishedFactChars ?? 2_400,
  );
  if (observationLines.length > 0) {
    sections.push("## Established observations", ...observationLines);
  }

  if (sections.length === 0) {
    return undefined;
  }

  return [
    WORKING_SET_MARKER,
    "Live execution state for this turn. Prefer this over dropped tool history.",
    "",
    ...sections,
    "</working_set>",
  ].join("\n");
}

function formatEstablishedObservationLines(
  facts: readonly EstablishedFact[],
  maxChars: number,
): string[] {
  const lines: string[] = [];
  let used = 0;
  for (const fact of facts) {
    const line = `- (${fact.id}) ${fact.content}`;
    if (used + line.length + 1 > maxChars) {
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines;
}
