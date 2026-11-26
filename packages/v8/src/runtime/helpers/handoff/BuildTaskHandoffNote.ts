/**
 * Build a TaskHandoffNote (S13-CONTRACT).
 */

import {
  taskHandoffNoteSchema,
  type TaskHandoffNote,
} from "../../contracts/handoff/TaskHandoffNote";
import { sanitizeHandoffText } from "./SanitizeHandoffText";

export interface BuildTaskHandoffNoteInput {
  fromTaskId: string;
  toTaskId?: string;
  doneSummary: string;
  artifactsWritten?: readonly string[];
  evidenceRefs?: readonly string[];
  blockersRemaining?: readonly string[];
  nextMustRead?: readonly string[];
  assumptions?: readonly string[];
  impactSiteIds?: readonly string[];
}

export function buildTaskHandoffNote(
  input: BuildTaskHandoffNoteInput,
): TaskHandoffNote {
  return taskHandoffNoteSchema.parse({
    schemaVersion: 1,
    fromTaskId: input.fromTaskId,
    ...(input.toTaskId ? { toTaskId: input.toTaskId } : {}),
    doneSummary: sanitizeHandoffText(input.doneSummary),
    artifactsWritten: [...(input.artifactsWritten ?? [])].slice(0, 32),
    evidenceRefs: [...(input.evidenceRefs ?? [])].slice(0, 32),
    blockersRemaining: [...(input.blockersRemaining ?? [])].slice(0, 16),
    nextMustRead: [...(input.nextMustRead ?? [])].slice(0, 16),
    assumptions: [...(input.assumptions ?? [])]
      .map((a) => sanitizeHandoffText(a, 240))
      .slice(0, 16),
    ...(input.impactSiteIds
      ? { impactSiteIds: [...input.impactSiteIds].slice(0, 32) }
      : {}),
  });
}
