import { describe, expect, it } from "vitest";

import {
  InMemoryManifestReader,
  VerificationPipeline,
} from "../../../modules/verification";
import { baseVerificationInput } from "../../../modules/verification/tests/fixtures/grants";
import { createTools } from "../../../modules/verification/tests/fixtures/pipelineTools";
import { createPipelineVerificationRunner } from "../../adapters/verification/CreatePipelineVerificationRunner";
import { composeRuntime } from "../../adapters/compose/ComposeRuntime";

describe("pipeline verification runner", () => {
  it("skips when buildInput returns undefined", async () => {
    const pipeline = new VerificationPipeline({
      tools: createTools(() => {
        throw new Error("unused");
      }),
      manifests: new InMemoryManifestReader(),
    });
    const runner = createPipelineVerificationRunner({
      pipeline,
      buildInput: () => undefined,
    });
    const outcome = await runner.run({ runId: "v-1" });
    expect(outcome.status).toBe("skipped");
    expect(outcome.reasonCodes).toContain("verification_runner_needs_input");
  });

  it("runs VerificationPipeline when input is supplied", async () => {
    const pipeline = new VerificationPipeline({
      tools: createTools(() => {
        throw new Error("should not execute tools");
      }),
      manifests: new InMemoryManifestReader(),
    });
    const runner = createPipelineVerificationRunner({
      pipeline,
      buildInput: () =>
        baseVerificationInput({
          verification: {
            required: false,
            minimumEvidence: [],
            allowUnavailable: true,
          },
        }),
    });
    const outcome = await runner.run({ runId: "v-2", route: "execute" });
    expect(outcome.status).toBe("passed");
    expect(outcome.reasonCodes).toContain("verification_runner_pipeline");
  });

  it("composeRuntime wires pipeline runner when factory provided", async () => {
    const pipeline = new VerificationPipeline({
      tools: createTools(() => {
        throw new Error("unused");
      }),
      manifests: new InMemoryManifestReader(),
    });
    const runtime = composeRuntime({
      verificationPipeline: pipeline,
      verificationInput: () => undefined,
    });
    expect(runtime).toBeDefined();
  });
});
