import type { UserRequestEnvelope } from "../../../request-intake";
import {
  directionAnalysisInputSchema,
  type DirectionAnalysisInput,
} from "../../contracts/input/DirectionAnalysisInput";
import type { RequestUnderstandingOptions } from "../../flow/types";

/**
 * SituationPack-lite for legacy understand() → assessDirection (S2-RU).
 * Omits intent rule priors (S2-PRIORS).
 */
export function buildDirectionInputFromEnvelope(
  envelope: UserRequestEnvelope,
  options: RequestUnderstandingOptions = {},
): DirectionAnalysisInput {
  const focus =
    options.candidateRelativePaths?.slice(0, 12) ??
    envelope.referencedArtifacts
      ?.map((a) => a.path ?? a.name)
      .filter((path): path is string => Boolean(path?.trim()))
      .slice(0, 12) ??
    [];

  return directionAnalysisInputSchema.parse({
    schemaVersion: 1,
    userCommand: envelope.message?.trim() || "(empty)",
    mode: envelope.mode ?? "agent",
    turnKind: envelope.turnKind ?? "new",
    situationSummary: {
      focusPaths: focus,
      dirtyPaths: [],
    },
    historyDigest: options.historyDigest
      ? {
          digest: options.historyDigest,
          priorRoute: options.priorRoute,
          priorTaskBand: options.priorTaskSize,
        }
      : options.priorRoute || options.priorTaskSize
        ? {
            priorRoute: options.priorRoute,
            priorTaskBand: options.priorTaskSize,
          }
        : undefined,
    attachedMcp: (options.requiredMcpServerIds ?? []).map((serverId) => ({
      serverId,
      required: true,
    })),
    candidateFiles: focus
      .filter((path) => /\.[\w.+-]+$/.test(path))
      .map((path) => ({ path, kind: "file" })),
  });
}
