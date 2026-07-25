import { agentModeSchema } from "../interaction-mode/schema";
import { UserRequestEnvelopeBuilder } from "../request-envelope/UserRequestEnvelopeBuilder";
import type {
  CreateUserRequestInput,
  UserRequestEnvelope,
  UserRequestEnvelopeBuilderDependencies,
} from "../request-envelope/types";

export type RequestIntakePipelineDependencies =
  UserRequestEnvelopeBuilderDependencies;

/**
 * Primary request-intake facade: validates interaction mode and builds
 * a normalized UserRequestEnvelope from raw host input.
 */
export class RequestIntakePipeline {
  private readonly builder: UserRequestEnvelopeBuilder;

  constructor(dependencies: RequestIntakePipelineDependencies) {
    this.builder = new UserRequestEnvelopeBuilder(dependencies);
  }

  public intake(input: CreateUserRequestInput): UserRequestEnvelope {
    const mode = agentModeSchema.parse(input.mode);
    return this.builder.build({
      ...input,
      mode,
    });
  }
}
