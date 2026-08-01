import { createUserRequestInputSchema } from "../contracts/input/CreateUserRequestInput";
import type { CreateUserRequestInput } from "../contracts/input/CreateUserRequestInput";
import { UserRequestEnvelopeBuilder } from "../request-envelope/UserRequestEnvelopeBuilder";
import type {
  UserRequestEnvelope,
  UserRequestEnvelopeBuilderDependencies,
} from "../request-envelope/types";

export type RequestIntakePipelineDependencies =
  UserRequestEnvelopeBuilderDependencies;

/**
 * Primary request-intake facade: validates boundary input and builds
 * a normalized UserRequestEnvelope from raw host input.
 */
export class RequestIntakePipeline {
  private readonly builder: UserRequestEnvelopeBuilder;

  constructor(dependencies: RequestIntakePipelineDependencies) {
    this.builder = new UserRequestEnvelopeBuilder(dependencies);
  }

  public intake(input: CreateUserRequestInput): UserRequestEnvelope {
    const validated = createUserRequestInputSchema.parse(input);
    return this.builder.build(validated);
  }
}
