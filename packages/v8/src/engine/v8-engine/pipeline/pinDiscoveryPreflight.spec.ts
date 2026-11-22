import { describe, expect, it } from "vitest";

import type { ToolGrant } from "../../../modules/decision-policy";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { AgentReasonCode } from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import { createDiscoveryObservationCollector } from "../internal/discovery";
import { DEFAULT_DISCOVERY_PASS_BUDGET } from "../modules/plan-discovery";
import { runDiscoverySeedAndShapedPreflight } from "./pinDiscoveryPreflight";
import type { AgentEngineRuntime } from "./runtime";

function setup() {
  const reads: string[] = [];
  const runtime = {
    emit: () => undefined,
    isoNow: () => "2026-01-01T00:00:00.000Z",
    deps: {
      tools: {
        execute: async (request: {
          toolName: string;
          arguments: { path?: string };
        }) => {
          if (request.toolName === "read_file" && request.arguments.path) {
            reads.push(request.arguments.path);
            return {
              status: "succeeded",
              output: { content: `// ${request.arguments.path}` },
            };
          }
          return { status: "succeeded", output: { matches: [] } };
        },
      },
    },
  } as unknown as AgentEngineRuntime;
  return { runtime, reads };
}

async function preflight(params: {
  preferredPaths: string[];
  knownPaths?: string[];
  trustedPaths?: string[];
}) {
  const { runtime, reads } = setup();
  const reasonCodes: AgentReasonCode[] = [];
  const result = await runDiscoverySeedAndShapedPreflight({
    runtime,
    runId: "run_seed",
    bus: new EventBus(),
    budget: new RunBudgetTracker({
      maxModelCalls: 10,
      maxToolCalls: 40,
      maxLoopIterations: 20,
    } as never),
    collector: createDiscoveryObservationCollector(DEFAULT_DISCOVERY_PASS_BUDGET),
    grant: { allowedTools: ["read_file", "glob_files", "search_files"] } as ToolGrant,
    workspaceRoot: "/repo",
    pinnedState: undefined,
    windowPolicy: {
      compaction: { toolResultContentChars: 4_000 },
    } as unknown as WindowPolicy,
    query: "fix the login bug",
    preferredPaths: params.preferredPaths,
    seedPathHygiene: {
      knownPaths: params.knownPaths,
      trustedPaths: params.trustedPaths,
    },
    qualityFloor: false,
    seedFirstDiscovery: true,
    discoveryBudget: DEFAULT_DISCOVERY_PASS_BUDGET,
    signal: new AbortController().signal,
    reasonCodes,
  });
  return { result, reads, reasonCodes };
}

describe("discovery seed path hygiene before read_file", () => {
  it("never reads prose tokens and resolves basenames through the index", async () => {
    const { reads, reasonCodes } = await preflight({
      preferredPaths: ["Node.js", "login.ts", "src/auth/session.ts"],
      knownPaths: ["src/auth/login.ts", "src/auth/session.ts"],
    });

    expect(reads).toContain("src/auth/login.ts");
    expect(reads).toContain("src/auth/session.ts");
    expect(reads).not.toContain("Node.js");
    expect(reads).not.toContain("login.ts");
    expect(reasonCodes).toContain("discovery_seed_paths_filtered");
  });

  it("does not report filtering when every seed is already a clean indexed path", async () => {
    const { reads, reasonCodes } = await preflight({
      preferredPaths: ["src/auth/login.ts"],
      knownPaths: ["src/auth/login.ts"],
    });
    expect(reads).toEqual(["src/auth/login.ts"]);
    expect(reasonCodes).not.toContain("discovery_seed_paths_filtered");
  });

  it("reads user-named paths that are not indexed yet", async () => {
    const { reads } = await preflight({
      preferredPaths: ["src/server.ts"],
      knownPaths: ["src/auth/login.ts"],
      trustedPaths: ["src/server.ts"],
    });
    expect(reads).toContain("src/server.ts");
  });
});
