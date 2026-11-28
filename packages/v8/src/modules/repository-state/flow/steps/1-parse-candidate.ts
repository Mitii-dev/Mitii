import { publishRepositoryStateInputSchema } from "../../contracts/input/PublishRepositoryStateInput";
import type { PublishRepositoryStateInput } from "../../contracts/input/PublishRepositoryStateInput";
import { publishRepositoryStateResultSchema } from "../../contracts/output/RepositoryStateResults";
import type { PublishRepositoryStateResult } from "../../contracts/output/RepositoryStateResults";
import { REPOSITORY_STATE_MESSAGES } from "../../constants";

export type ParseCandidateResult =
  | { ok: true; candidate: PublishRepositoryStateInput }
  | { ok: false; result: PublishRepositoryStateResult };

export function parseCandidateStep(
  input: PublishRepositoryStateInput,
): ParseCandidateResult {
  try {
    return {
      ok: true,
      candidate: publishRepositoryStateInputSchema.parse(input),
    };
  } catch (error) {
    return {
      ok: false,
      result: publishRepositoryStateResultSchema.parse({
        status: "failed",
        code: "invalid_candidate",
        message:
          error instanceof Error
            ? error.message
            : REPOSITORY_STATE_MESSAGES.invalidCandidate,
      }),
    };
  }
}
