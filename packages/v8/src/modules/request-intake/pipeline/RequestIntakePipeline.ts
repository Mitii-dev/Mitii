import { createUserRequestInputSchema } from "../contracts/input/CreateUserRequestInput";
import type { CreateUserRequestInput } from "../contracts/input/CreateUserRequestInput";
import { UserRequestEnvelopeBuilder } from "../request-envelope/UserRequestEnvelopeBuilder";
import type {
  UserRequestEnvelope,
  UserRequestEnvelopeBuilderDependencies,
} from "../request-envelope/types";
import { REQUEST_ENVELOPE_DEFAULTS } from "../request-envelope/constants";
import { sanitizeUserMessage } from "../sanitize";
import { classifyLeadingCommand } from "../command-classify";
import {
  extractMentionArtifacts,
  mergeReferencedArtifacts,
} from "../mention-extract";
import { normalizeAttachments } from "../attachment-normalize";
import { resolveInteractionMode } from "../interaction-mode/resolveMode";
import type { AgentMode } from "../interaction-mode/types";

export type RequestIntakePipelineDependencies =
  UserRequestEnvelopeBuilderDependencies;

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
 * Primary request-intake facade.
 *
 * Stages (inject, not drop-in peer copies):
 * sanitize → command-classify → mention-extract → attachment-normalize
 * → mode-resolve → validate → build envelope.
 */
export class RequestIntakePipeline {
  private readonly builder: UserRequestEnvelopeBuilder;

  constructor(dependencies: RequestIntakePipelineDependencies) {
    this.builder = new UserRequestEnvelopeBuilder(dependencies);
  }

  /**
   * Validate + staged inject parse → normalized envelope.
   * Prefer {@link intakeDetailed} when callers need short-circuit flags.
   */
  public intake(input: CreateUserRequestInput): UserRequestEnvelope {
    return this.intakeDetailed(input).envelope;
  }

  public intakeDetailed(input: CreateUserRequestInput): RequestIntakeResult {
    const validated = createUserRequestInputSchema.parse(input);
    const warnings: string[] = [];

    // 1. Sanitize
    const sanitized = sanitizeUserMessage(validated.userMessage);
    let message = sanitized;
    let messageOriginal: string | undefined;
    let slashMode: AgentMode | undefined;
    let metaCommand = validated.metaCommand;
    let shortCircuitMeta = false;

    // 2. Command classify (host metaCommand wins)
    if (!metaCommand) {
      const classified = classifyLeadingCommand(sanitized);
      if (classified.kind === "mode") {
        slashMode = classified.mode;
        // Bare `/plan` with no args: keep original text so content rules pass.
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
      shortCircuitMeta =
        metaCommand.lifecycle !== "agent_turn" &&
        !(
          metaCommand.lifecycle === "agent_turn_with_args" &&
          metaCommand.args.trim().length > 0
        );
    }

    // 3. Mention extract → artifacts (paths only; keep @ text in message)
    const extracted = extractMentionArtifacts(message);
    const hostArtifacts = (validated.referencedArtifacts ?? []).map(
      (artifact) => ({ ...artifact }),
    );
    const referencedArtifacts = mergeReferencedArtifacts(
      hostArtifacts,
      extracted,
    );

    // 4. Attachment normalize
    const attachmentResult = normalizeAttachments(validated.attachments);
    warnings.push(...attachmentResult.warnings);

    // 5. Mode resolve
    const mode = resolveInteractionMode({
      hostMode: validated.mode,
      slashMode,
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

    return {
      envelope,
      warnings,
      shortCircuitMeta,
    };
  }
}
