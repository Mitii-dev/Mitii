import { REQUEST_INTAKE_STAGES } from "../constants";
import { createUserRequestInputSchema } from "../types/input/CreateUserRequestInput";
import type { CreateUserRequestInput } from "../types/input/CreateUserRequestInput";
import type { AgentMode } from "../types";
import {
  noopModuleLogger,
  type ModuleLoggerPort,
} from "../ports/ModuleLoggerPort";
import type {
  UserRequestEnvelope,
  UserRequestEnvelopeBuilderDependencies,
} from "../helpers/request-envelope/types";
import { REQUEST_ENVELOPE_DEFAULTS } from "../rules";
import {
  sanitizeUserMessage,
  classifyLeadingCommand,
  extractMentionArtifacts,
  mergeReferencedArtifacts,
  normalizeAttachments,
  resolveInteractionMode,
  UserRequestEnvelopeBuilder,
} from "./steps";

export type RequestIntakePipelineDependencies =
  UserRequestEnvelopeBuilderDependencies & {
    log?: ModuleLoggerPort;
  };

export type RequestIntakeResult = {
  envelope: UserRequestEnvelope;
  /** Intake-local warnings (attachment drops, etc.). */
  warnings: string[];
  /**
   * True when metaCommand lifecycle must short-circuit the agent path
   * (side_channel / stop / finalize, or agent_turn_with_args without args).
   */
  shortCircuitMeta: boolean;
};

/**
 * Request Intake facade.
 *
 * Flow:
 *   1-sanitize → 2-classify-command → 3-extract-mentions
 *   → 4-normalize-attachments → 5-resolve-mode → 6-build-envelope
 *
 * Does not load file contents, call LLMs, or own session storage.
 */
export class RequestIntakePipeline {
  private readonly builder: UserRequestEnvelopeBuilder;
  private readonly log: ModuleLoggerPort;

  constructor(dependencies: RequestIntakePipelineDependencies) {
    this.builder = new UserRequestEnvelopeBuilder({
      clock: dependencies.clock,
      idGenerator: dependencies.idGenerator,
    });
    this.log = dependencies.log ?? noopModuleLogger;
  }

  /**
   * Validate + staged parse → normalized envelope.
   * Prefer {@link intakeDetailed} when callers need short-circuit flags.
   */
  public intake(input: CreateUserRequestInput): UserRequestEnvelope {
    return this.intakeDetailed(input).envelope;
  }

  public intakeDetailed(input: CreateUserRequestInput): RequestIntakeResult {
    const validated = createUserRequestInputSchema.parse(input);
    const warnings: string[] = [];

    // 1. Sanitize
    let startedMs = Date.now();
    const sanitized = sanitizeUserMessage(validated.userMessage);
    this.log.stage({
      module: "request-intake",
      stage: REQUEST_INTAKE_STAGES.sanitize,
      durationMs: Date.now() - startedMs,
      reasonCodes: [],
      inputSummary: { messageChars: validated.userMessage.length },
      outputSummary: { messageChars: sanitized.length },
    });

    let message = sanitized;
    let messageOriginal: string | undefined;
    let slashMode: AgentMode | undefined;
    let metaCommand = validated.metaCommand;
    let shortCircuitMeta = false;
    let classifyKind: "none" | "mode" | "meta" | "host_meta" = "none";

    // 2. Command classify (host metaCommand wins)
    startedMs = Date.now();
    if (!metaCommand) {
      const classified = classifyLeadingCommand(sanitized);
      classifyKind = classified.kind;
      if (classified.kind === "mode") {
        slashMode = classified.mode;
        message =
          classified.message.length > 0
            ? classified.message
            : classified.messageOriginal;
        messageOriginal =
          classified.message.length > 0
            ? classified.messageOriginal
            : undefined;
      } else if (classified.kind === "meta") {
        metaCommand = classified.metaCommand;
        message = classified.message;
        messageOriginal = classified.messageOriginal;
        shortCircuitMeta = !classified.entersAgentTurn;
      }
    } else {
      classifyKind = "host_meta";
      shortCircuitMeta =
        metaCommand.lifecycle !== "agent_turn" &&
        !(
          metaCommand.lifecycle === "agent_turn_with_args" &&
          metaCommand.args.trim().length > 0
        );
    }
    this.log.stage({
      module: "request-intake",
      stage: REQUEST_INTAKE_STAGES.classifyCommand,
      durationMs: Date.now() - startedMs,
      reasonCodes: metaCommand ? [`meta:${metaCommand.name}`] : [],
      outputSummary: {
        kind: classifyKind,
        slashMode,
        shortCircuitMeta,
        metaName: metaCommand?.name,
      },
    });

    // 3. Mention extract → artifacts (paths only; keep @ text in message)
    startedMs = Date.now();
    const extracted = extractMentionArtifacts(message);
    const hostArtifacts = (validated.referencedArtifacts ?? []).map(
      (artifact) => ({ ...artifact }),
    );
    const referencedArtifacts = mergeReferencedArtifacts(
      hostArtifacts,
      extracted,
    );
    this.log.stage({
      module: "request-intake",
      stage: REQUEST_INTAKE_STAGES.extractMentions,
      durationMs: Date.now() - startedMs,
      reasonCodes: [],
      outputSummary: {
        hostArtifactCount: hostArtifacts.length,
        extractedCount: extracted.length,
        mergedCount: referencedArtifacts.length,
      },
    });

    // 4. Attachment normalize
    startedMs = Date.now();
    const attachmentResult = normalizeAttachments(validated.attachments);
    warnings.push(...attachmentResult.warnings);
    this.log.stage({
      module: "request-intake",
      stage: REQUEST_INTAKE_STAGES.normalizeAttachments,
      durationMs: Date.now() - startedMs,
      reasonCodes: attachmentResult.warnings,
      outputSummary: {
        kept: attachmentResult.attachments.length,
        warningCount: attachmentResult.warnings.length,
      },
    });

    // 5. Mode resolve
    startedMs = Date.now();
    const mode = resolveInteractionMode({
      hostMode: validated.mode,
      slashMode,
    });
    this.log.stage({
      module: "request-intake",
      stage: REQUEST_INTAKE_STAGES.resolveMode,
      durationMs: Date.now() - startedMs,
      reasonCodes: [`mode:${mode}`],
      inputSummary: { hostMode: validated.mode, slashMode },
      outputSummary: { mode },
    });

    const buildInput: CreateUserRequestInput = {
      ...validated,
      userMessage: message,
      mode,
      referencedArtifacts,
      attachments:
        attachmentResult.attachments.length > 0
          ? attachmentResult.attachments
          : undefined,
      metaCommand,
      turnKind: validated.turnKind ?? REQUEST_ENVELOPE_DEFAULTS.TURN_KIND,
    };

    // Re-validate after inject stages (limits / empty rules).
    const revalidated = createUserRequestInputSchema.parse(buildInput);

    // 6. Build envelope
    startedMs = Date.now();
    const envelope = this.builder.build(revalidated, {
      mode,
      message,
      messageOriginal,
      referencedArtifacts,
      attachments:
        attachmentResult.attachments.length > 0
          ? attachmentResult.attachments
          : undefined,
      turnKind: revalidated.turnKind ?? REQUEST_ENVELOPE_DEFAULTS.TURN_KIND,
      sessionAction: revalidated.sessionAction,
      parentRequestId: revalidated.parentRequestId,
      metaCommand,
    });
    this.log.stage({
      module: "request-intake",
      stage: REQUEST_INTAKE_STAGES.buildEnvelope,
      durationMs: Date.now() - startedMs,
      reasonCodes: [],
      outputSummary: {
        requestId: envelope.requestId,
        mode: envelope.mode,
        turnKind: envelope.turnKind,
        artifactCount: envelope.referencedArtifacts.length,
        shortCircuitMeta,
      },
    });

    return {
      envelope,
      warnings,
      shortCircuitMeta,
    };
  }
}
