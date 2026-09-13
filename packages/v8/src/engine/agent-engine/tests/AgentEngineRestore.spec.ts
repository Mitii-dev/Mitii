import { describe, expect, it } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  directory,
  file,
} from "../../tool-runtime";
import { DecisionPolicyPipeline } from "../../../modules/decision-policy";
import { PromptConstructionPipeline } from "../../../modules/prompt-construction";
import { RequestIntakePipeline } from "../../../modules/request-intake";
import { RequestUnderstandingPipeline } from "../../../modules/request-understanding";

import {
  AgentEnginePipeline,
  InMemoryRunCheckpointStore,
  restorePointSchema,
} from "..";
import type { AgentEngineToolRuntimePort } from "../contracts";
import {
  ScriptedLlmPort,
  createCapabilities,
  createStubDependencies,
} from "./fixtures/stubs";

const WORKSPACE = "/workspace";

function wrapTools(realTools: ToolRuntimePipeline): AgentEngineToolRuntimePort {
  return {
    execute: (input, options) => realTools.execute(input, options),
    rollbackMutation: (input) => realTools.rollbackMutation(input),
    commitMutation: (checkpointId) => realTools.commitMutation(checkpointId),
    getMutationCheckpoint: (id) => realTools.getMutationCheckpoint(id),
    restoreMutationSnapshot: (snapshot) =>
      realTools.restoreMutationSnapshot(snapshot),
  };
}

describe("AgentEngine restore points", () => {
  it("restores file bytes from a durable RestorePoint", async () => {
    const tree = directory({
      src: directory({ "a.ts": file("const x = 1;\n") }),
    });
    const fs = new InMemoryFileSystemAdapter(WORKSPACE, tree);
    const realTools = new ToolRuntimePipeline({
      fileSystem: fs,
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    });
    const store = new InMemoryRunCheckpointStore();
    const deps = createStubDependencies({
      llm: new ScriptedLlmPort([
        async function* () {
          yield {
            type: "assistant_message",
            message: { role: "assistant", content: "ok" },
          };
          yield { type: "finished", finishReason: "stop" };
        },
      ]),
    });
    deps.tools = wrapTools(realTools);
    deps.checkpointStore = store;

    const engine = new AgentEnginePipeline(deps);
    const point = restorePointSchema.parse({
      schemaVersion: 1,
      restorePointId: "rp_1",
      runId: "run_1",
      requestId: "req_1",
      createdAt: new Date().toISOString(),
      interactionMode: "agent",
      mutationSnapshot: {
        checkpointId: "cp_1",
        workspaceRoot: WORKSPACE,
        files: [
          {
            relativePath: "src/a.ts",
            kind: "existing",
            content: "const x = 1;\n",
          },
        ],
        createdAt: new Date().toISOString(),
      },
      mutationCheckpointIds: ["cp_1"],
      messages: [{ role: "user", content: "patch" }],
      toolCacheEntries: [],
      changedFiles: ["src/a.ts"],
    });
    await store.saveRestorePoint(point);
    await fs.writeFile(`${WORKSPACE}/src/a.ts`, "const x = 99;\n");

    const restored = await engine.restore({
      schemaVersion: 1,
      runId: "run_1",
      restorePointId: "rp_1",
      workspaceRoot: WORKSPACE,
    });

    expect(restored.interactionMode).toBe("agent");
    expect(restored.restoredFiles).toContain("src/a.ts");
    expect((await fs.readFile(`${WORKSPACE}/src/a.ts`)).content).toBe(
      "const x = 1;\n",
    );
    expect(await engine.listRestorePoints("run_1")).toHaveLength(1);
  });

  it("does not escalate ask mode from a restore point", async () => {
    const tree = directory({
      "a.ts": file("one\n"),
    });
    const fs = new InMemoryFileSystemAdapter(WORKSPACE, tree);
    const realTools = new ToolRuntimePipeline({
      fileSystem: fs,
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    });
    const store = new InMemoryRunCheckpointStore();
    const engine = new AgentEnginePipeline({
      intake: new RequestIntakePipeline({
        clock: { now: () => Date.now() },
        idGenerator: { generate: (ns: string) => `${ns}_x` },
      }),
      understanding: new RequestUnderstandingPipeline(
        new ScriptedLlmPort([
          async function* () {
            yield {
              type: "assistant_message",
              message: { role: "assistant", content: "{}" },
            };
            yield { type: "finished", finishReason: "stop" };
          },
        ]),
      ),
      decision: new DecisionPolicyPipeline(),
      prompt: new PromptConstructionPipeline(),
      llm: new ScriptedLlmPort([
        async function* () {
          yield {
            type: "assistant_message",
            message: { role: "assistant", content: "ok" },
          };
          yield { type: "finished", finishReason: "stop" };
        },
      ], createCapabilities()),
      tools: wrapTools(realTools),
      checkpointStore: store,
    });

    const point = restorePointSchema.parse({
      schemaVersion: 1,
      restorePointId: "rp_ask",
      runId: "run_ask",
      requestId: "req_ask",
      createdAt: new Date().toISOString(),
      interactionMode: "ask",
      mutationSnapshot: {
        checkpointId: "cp_ask",
        workspaceRoot: WORKSPACE,
        files: [
          { relativePath: "a.ts", kind: "existing", content: "one\n" },
        ],
        createdAt: new Date().toISOString(),
      },
      mutationCheckpointIds: ["cp_ask"],
      messages: [{ role: "user", content: "explain" }],
      toolCacheEntries: [],
      changedFiles: ["a.ts"],
    });
    await store.saveRestorePoint(point);
    await fs.writeFile(`${WORKSPACE}/a.ts`, "two\n");

    const restored = await engine.restore({
      schemaVersion: 1,
      runId: "run_ask",
      restorePointId: "rp_ask",
      workspaceRoot: WORKSPACE,
    });
    expect(restored.interactionMode).toBe("ask");
    expect((await fs.readFile(`${WORKSPACE}/a.ts`)).content).toBe("one\n");
  });
});
