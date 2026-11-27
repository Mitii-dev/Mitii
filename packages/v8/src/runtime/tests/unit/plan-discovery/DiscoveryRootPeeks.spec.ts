import { describe, expect, it, vi } from "vitest";

import { PLANNING_SCHEMA_VERSION } from "../../../../modules/planning";
import { resolveDiscoveryPassBudget } from "../../../../modules/window-budget";
import {
  pickRootPeekPaths,
  peekDiscoveryFromWorkspaceRoot,
  runDiscoveryPass,
} from "../../../helpers/plan-discovery";
import type { RuntimeToolExecutorPort } from "../../../ports/RuntimeToolExecutorPort";

describe("DiscoveryRootPeeks", () => {
  it("pickRootPeekPaths prefers productive docs over manifests", () => {
    const paths = pickRootPeekPaths(
      [
        "node_modules",
        "requirement.txt",
        "index.html",
        "package.json",
        "photo.png",
        "notes.md",
      ],
      3,
    );
    expect(paths[0]).toBe("requirement.txt");
    expect(paths).toContain("index.html");
    expect(paths.length).toBeLessThanOrEqual(3);
    expect(paths).not.toContain("photo.png");
  });

  it("peekDiscoveryFromWorkspaceRoot lists then reads", async () => {
    const tools: RuntimeToolExecutorPort = {
      execute: vi.fn(async (input) => {
        if (input.toolId === "list_directory") {
          return {
            ok: true,
            output: {
              entries: [
                { name: "requirement.txt", kind: "file" },
                { name: "index.html", kind: "file" },
              ],
            },
          };
        }
        return { ok: true, output: { path: (input.args as { path: string }).path } };
      }),
    };
    const budget = resolveDiscoveryPassBudget("medium", 80_000);
    const result = await peekDiscoveryFromWorkspaceRoot({
      observation: {
        schemaVersion: PLANNING_SCHEMA_VERSION,
        objective: "plan guest app",
        filesRead: [],
        searchHits: [],
        explicitTargets: [],
        constraints: [],
        verificationHints: [],
        notes: [],
      },
      tools,
      grant: {
        allowedTools: ["list_directory", "read_file"],
        maximumWorkspaceEffect: "read",
        readPaths: ["."],
        writePaths: [],
      },
      budget,
      toolCalls: 0,
      fileReads: 0,
    });
    expect(result.reasonCodes).toContain("discovery_root_listed");
    expect(result.toolCalls).toBeGreaterThanOrEqual(2);
    expect(result.searches).toBeGreaterThanOrEqual(0);
    expect(result.observation.filesRead?.some((f) => f.path === "requirement.txt")).toBe(
      true,
    );
  });

  it("runDiscoveryPass peeks root when focus paths are empty", async () => {
    const tools: RuntimeToolExecutorPort = {
      execute: vi.fn(async (input) => {
        if (input.toolId === "list_directory") {
          return {
            ok: true,
            output: {
              entries: [{ name: "AGENTS.md", kind: "file" }],
            },
          };
        }
        if (input.toolId === "glob_files") {
          return {
            ok: true,
            output: {
              matches: [{ path: "docs/AUTHORING.md", kind: "file" }],
            },
          };
        }
        return { ok: true, output: {} };
      }),
    };
    const budget = resolveDiscoveryPassBudget("medium", 80_000);
    const result = await runDiscoveryPass({
      objective: "plan implementing app from workspace contents",
      pack: {
        schemaVersion: 1,
        requestText: "plan an app",
        request: { text: "plan an app" },
        scope: { focusPaths: [], fencePaths: [], evidence: "host" },
        navigation: { surroundings: [] },
        pins: {},
      } as never,
      budget,
      tools,
    });
    expect(result.reasonCodes).toContain("discovery_root_listed");
    expect(result.reasonCodes).not.toContain("discovery_seed_only");
    expect(result.toolCalls).toBeGreaterThan(0);
    expect(result.brief.filesRead.some((f) => f.path === "AGENTS.md")).toBe(true);
  });
});
