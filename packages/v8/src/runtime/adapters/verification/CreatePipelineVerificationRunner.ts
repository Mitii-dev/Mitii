import type { VerificationPipeline } from "../../../modules/verification";
import type { VerificationInput } from "../../../modules/verification";
import type {
  RuntimeVerificationOutcome,
  RuntimeVerificationRunnerPort,
} from "../../ports/RuntimeVerificationRunnerPort";

export type VerificationInputFactory = (ctx: {
  runId: string;
  route?: string;
}) => VerificationInput | undefined | Promise<VerificationInput | undefined>;

/**
 * Adapter: modules/verification VerificationPipeline → RuntimeVerificationRunnerPort.
 * When `buildInput` returns undefined, runner skips (host did not supply workspace/pin).
 */
export function createPipelineVerificationRunner(deps: {
  pipeline: VerificationPipeline;
  buildInput: VerificationInputFactory;
}): RuntimeVerificationRunnerPort {
  return {
    async run(input): Promise<RuntimeVerificationOutcome> {
      const built = await deps.buildInput({
        runId: input.runId,
        route: input.route,
      });
      if (!built) {
        return {
          status: "skipped",
          reasonCodes: ["verification_runner_needs_input"],
        };
      }

      try {
        const result = await deps.pipeline.verify(built);
        return {
          status: mapStatus(result.status),
          reasonCodes: [
            "verification_runner_pipeline",
            ...result.reasonCodes.slice(0, 8),
          ],
        };
      } catch {
        return {
          status: "failed",
          reasonCodes: ["verification_runner_pipeline_failed"],
        };
      }
    },
  };
}

function mapStatus(
  status: string,
): RuntimeVerificationOutcome["status"] {
  if (status === "verified_success") return "passed";
  if (status === "blocked" || status === "cancelled") return "skipped";
  if (status === "implemented_unverified") return "passed";
  return "failed";
}
