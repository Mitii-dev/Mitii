import type {
  AgentMode,
  RequestArtifactReference,
  RequestImageAttachment,
  RequestTurnKind,
  UserRequestOrigin,
} from "../../../request-intake";
import type { DiagnosticSummary } from "../../contracts";
import { DEFAULT_CLOSED_SKILL_TAGS } from "../intersectRecommendedSkillTags";
import type { RulePrior } from "./UnderstandingEvidencePack";
import {
  understandingEvidencePackSchema,
  type UnderstandingEvidencePack,
} from "./UnderstandingEvidencePack";
import {
  computeSizeDraft,
  countApproxWords,
  looksLikePasteDump,
  looksLikeTestFailurePaste,
} from "./sizeDraft";

export interface BuildUnderstandingEvidencePackInput {
  mode: AgentMode;
  turnKind?: RequestTurnKind;
  origin?: UserRequestOrigin;
  /** Primary ask text already extracted for classification. */
  messageText: string;
  /** Full envelope message length (may include host context). */
  originalMessageLength: number;
  referencedArtifacts?: readonly RequestArtifactReference[];
  attachments?: readonly RequestImageAttachment[];
  rulePriors?: readonly RulePrior[];
  diagnosticSummary?: DiagnosticSummary;
  requiredMcpServerIds?: readonly string[];
  availableSkillTags?: readonly string[];
  historyDigest?: string;
  priorRoute?: string;
  priorTaskSize?: "small" | "medium" | "large";
}

export function buildUnderstandingEvidencePack(
  input: BuildUnderstandingEvidencePackInput,
): UnderstandingEvidencePack {
  const artifacts = summarizeArtifacts(input.referencedArtifacts ?? []);
  const attachments = summarizeAttachments(input.attachments ?? []);
  const approxWords = countApproxWords(input.messageText);
  const sizeDraft = computeSizeDraft({
    text: input.messageText,
    pinnedFolder: artifacts.pinnedFolder,
    pinnedFileCount: artifacts.files.length,
    approxWords,
  });

  const pack: UnderstandingEvidencePack = {
    mode: input.mode,
    turnKind: input.turnKind ?? "new",
    ...(input.origin ? { origin: input.origin } : {}),
    message: {
      text: input.messageText,
      originalLength: input.originalMessageLength,
      approxWords,
      looksLikePasteDump: looksLikePasteDump(input.messageText),
      looksLikeTestFailurePaste: looksLikeTestFailurePaste(input.messageText),
    },
    artifacts,
    attachments,
    mcp: {
      requiredServerIds: [...(input.requiredMcpServerIds ?? [])].slice(0, 10),
    },
    skills: {
      availableTags: [
        ...(input.availableSkillTags ?? [...DEFAULT_CLOSED_SKILL_TAGS]),
      ]
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 64),
    },
    rulePriors: [...(input.rulePriors ?? [])].slice(0, 3),
    sizeDraft,
    ...(input.diagnosticSummary
      ? {
          diagnostics: {
            errorCount: input.diagnosticSummary.errorCount,
          },
        }
      : {}),
    ...(input.historyDigest && input.historyDigest.trim()
      ? {
          history: {
            digest: input.historyDigest.trim().slice(0, 4000),
            ...(input.priorRoute ? { priorRoute: input.priorRoute } : {}),
            ...(input.priorTaskSize
              ? { priorTaskSize: input.priorTaskSize }
              : {}),
          },
        }
      : {}),
  };

  return understandingEvidencePackSchema.parse(pack);
}

function summarizeArtifacts(
  artifacts: readonly RequestArtifactReference[],
): UnderstandingEvidencePack["artifacts"] {
  const files: Array<{ path: string; kind: string }> = [];
  const folders: Array<{ path: string }> = [];
  const selections: Array<{
    path: string;
    startLine?: number;
    endLine?: number;
  }> = [];

  for (const artifact of artifacts.slice(0, 40)) {
    const path = (artifact.path ?? artifact.name ?? "").trim();
    if (!path) {
      continue;
    }
    if (artifact.kind === "folder") {
      folders.push({ path });
      continue;
    }
    if (artifact.kind === "selection") {
      selections.push({
        path,
        ...(typeof artifact.startLine === "number"
          ? { startLine: artifact.startLine }
          : {}),
        ...(typeof artifact.endLine === "number"
          ? { endLine: artifact.endLine }
          : {}),
      });
      continue;
    }
    files.push({ path, kind: artifact.kind });
  }

  return {
    files: files.slice(0, 40),
    folders: folders.slice(0, 20),
    selections: selections.slice(0, 20),
    pinnedFolder: folders.length > 0,
    pinnedFile: files.length > 0 || selections.length > 0,
    count: artifacts.length,
  };
}

function summarizeAttachments(
  attachments: readonly RequestImageAttachment[],
): UnderstandingEvidencePack["attachments"] {
  const images = attachments.slice(0, 20).map((attachment) => ({
    mimeType: attachment.mimeType,
    ...(attachment.name ? { name: attachment.name } : {}),
  }));
  return {
    imageCount: attachments.length,
    images,
  };
}

/**
 * Render investigator evidence for the Officer LLM user prompt.
 * Message text is included separately in a trust-tagged block.
 */
export function formatEvidencePackForPrompt(
  pack: UnderstandingEvidencePack,
): string {
  const withoutMessageText: UnderstandingEvidencePack = {
    ...pack,
    message: {
      ...pack.message,
      text: "[see message_to_classify]",
    },
  };
  return JSON.stringify(withoutMessageText, null, 2);
}
