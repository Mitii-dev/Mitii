import { describe, expect, it, beforeEach } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryNetworkAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  directory,
} from "../index";
import {
  appendPathsAfterDoubleDash,
  assertSafeGitArg,
  GitArgSafetyError,
} from "../internal/GitArgSafety";
import {
  SequentialThinkingEngine,
  resetSequentialThinkingEngines,
} from "../internal/SequentialThinking";
import {
  convertTime,
  getCurrentTime,
  TimeToolError,
} from "../internal/TimeTools";
import { matchDirectoryEntry } from "../internal/PathContainment";
import { createReadOnlyGrant } from "./fixtures/grants";

const WORKSPACE = "/workspace";

function createRuntime(networkBody?: string) {
  return new ToolRuntimePipeline({
    fileSystem: new InMemoryFileSystemAdapter(WORKSPACE, directory({})),
    process: new InMemoryProcessAdapter(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: false,
      truncated: false,
    })),
    network: new InMemoryNetworkAdapter(() => ({
      status: 200,
      body: networkBody ?? "x".repeat(250),
      headers: { "content-type": "text/plain" },
    })),
  });
}

describe("enterprise P0 techniques", () => {
  beforeEach(() => {
    resetSequentialThinkingEngines();
  });

  describe("fetch continuation windows", () => {
    it("returns nextStartIndex when body exceeds maxLength", async () => {
      const runtime = createRuntime("abcdefghijklmnopqrstuvwxyz");
      const result = await runtime.execute({
        schemaVersion: 1,
        callId: "f1",
        toolName: "fetch_url",
        arguments: {
          url: "https://docs.example.com/long",
          startIndex: 0,
          maxLength: 10,
        },
        grant: createReadOnlyGrant({
          allowedTools: ["fetch_url"],
          allowedEffects: ["network_access"],
          networkHosts: ["docs.example.com"],
        }),
        workspaceRoot: WORKSPACE,
      });
      expect(result.status).toBe("succeeded");
      const output = result.output as {
        body: string;
        truncated: boolean;
        startIndex: number;
        nextStartIndex?: number;
        totalLength: number;
      };
      expect(output.body).toBe("abcdefghij");
      expect(output.truncated).toBe(true);
      expect(output.startIndex).toBe(0);
      expect(output.nextStartIndex).toBe(10);
      expect(output.totalLength).toBe(26);
    });

    it("continues from nextStartIndex", async () => {
      const runtime = createRuntime("abcdefghijklmnopqrstuvwxyz");
      const result = await runtime.execute({
        schemaVersion: 1,
        callId: "f2",
        toolName: "fetch_url",
        arguments: {
          url: "https://docs.example.com/long",
          startIndex: 10,
          maxLength: 10,
        },
        grant: createReadOnlyGrant({
          allowedTools: ["fetch_url"],
          allowedEffects: ["network_access"],
          networkHosts: ["docs.example.com"],
        }),
        workspaceRoot: WORKSPACE,
      });
      const output = result.output as {
        body: string;
        nextStartIndex?: number;
      };
      expect(output.body).toBe("klmnopqrst");
      expect(output.nextStartIndex).toBe(20);
    });
  });

  describe("sequential_thinking", () => {
    it("tracks revisions and branches across calls", async () => {
      const runtime = createRuntime();
      const grant = createReadOnlyGrant({
        allowedTools: ["sequential_thinking"],
        allowedEffects: ["workspace_read"],
      });

      const first = await runtime.execute({
        schemaVersion: 1,
        callId: "s1",
        toolName: "sequential_thinking",
        arguments: {
          thought: "Hypothesis A",
          thoughtNumber: 1,
          totalThoughts: 2,
          nextThoughtNeeded: true,
        },
        grant,
        workspaceRoot: WORKSPACE,
      });
      expect(first.status).toBe("succeeded");

      const branched = await runtime.execute({
        schemaVersion: 1,
        callId: "s2",
        toolName: "sequential_thinking",
        arguments: {
          thought: "Alt path",
          thoughtNumber: 2,
          totalThoughts: 2,
          nextThoughtNeeded: "false",
          branchFromThought: 1,
          branchId: "b1",
        },
        grant,
        workspaceRoot: WORKSPACE,
      });
      expect(branched.status).toBe("succeeded");
      const output = branched.output as {
        branches: string[];
        thoughtHistoryLength: number;
        nextThoughtNeeded: boolean;
      };
      expect(output.branches).toEqual(["b1"]);
      expect(output.thoughtHistoryLength).toBe(2);
      expect(output.nextThoughtNeeded).toBe(false);
    });

    it("defaults missing thoughtNumber/totalThoughts instead of rejecting", async () => {
      const runtime = createRuntime();
      const result = await runtime.execute({
        schemaVersion: 1,
        callId: "s-defaults",
        toolName: "sequential_thinking",
        arguments: {
          thought: "Phase 0 inventory without counters",
          nextThoughtNeeded: "true",
        },
        grant: createReadOnlyGrant({
          allowedTools: ["sequential_thinking"],
          allowedEffects: ["workspace_read"],
        }),
        workspaceRoot: WORKSPACE,
      });
      expect(result.status).toBe("succeeded");
      const output = result.output as {
        thoughtNumber: number;
        totalThoughts: number;
        nextThoughtNeeded: boolean;
      };
      expect(output.thoughtNumber).toBe(1);
      expect(output.totalThoughts).toBe(1);
      expect(output.nextThoughtNeeded).toBe(true);
    });

    it("auto-extends totalThoughts and coerces string booleans", () => {
      const engine = new SequentialThinkingEngine();
      const result = engine.processThought({
        thought: "more",
        thoughtNumber: 5,
        totalThoughts: 3,
        nextThoughtNeeded: true,
      });
      expect(result.totalThoughts).toBe(5);
    });
  });

  describe("time tools", () => {
    it("get_current_time returns DST-aware snapshot for UTC", async () => {
      const runtime = createRuntime();
      const result = await runtime.execute({
        schemaVersion: 1,
        callId: "t1",
        toolName: "get_current_time",
        arguments: { timezone: "UTC" },
        grant: createReadOnlyGrant({
          allowedTools: ["get_current_time"],
          allowedEffects: ["workspace_read"],
        }),
        workspaceRoot: WORKSPACE,
      });
      expect(result.status).toBe("succeeded");
      const output = result.output as {
        timezone: string;
        datetime: string;
        dayOfWeek: string;
      };
      expect(output.timezone).toBe("UTC");
      expect(output.datetime).toMatch(/Z$|\+00:00$/);
      expect(output.dayOfWeek.length).toBeGreaterThan(0);
    });

    it("convert_time maps HH:MM across zones", () => {
      const result = convertTime({
        sourceTimezone: "UTC",
        time: "12:00",
        targetTimezone: "America/New_York",
        now: new Date("2024-01-15T00:00:00Z"),
      });
      expect(result.source.timezone).toBe("UTC");
      expect(result.target.timezone).toBe("America/New_York");
      expect(result.timeDifference).toMatch(/h$/);
    });

    it("rejects invalid timezone and time formats", () => {
      expect(() => getCurrentTime("Not/AZone")).toThrow(TimeToolError);
      expect(() =>
        convertTime({
          sourceTimezone: "UTC",
          time: "25:99",
          targetTimezone: "UTC",
        }),
      ).toThrow(TimeToolError);
    });
  });

  describe("git arg safety", () => {
    it("rejects leading-dash path args and uses -- separator", () => {
      expect(() => assertSafeGitArg("-rf", "git path")).toThrow(
        GitArgSafetyError,
      );
      expect(appendPathsAfterDoubleDash(["diff"], ["src/a.ts"])).toEqual([
        "diff",
        "--",
        "src/a.ts",
      ]);
    });
  });

  describe("path NFC matching", () => {
    it("prefers exact then NFC then case-insensitive", () => {
      expect(matchDirectoryEntry([{ name: "Foo" }], "Foo")).toBe("Foo");
      expect(
        matchDirectoryEntry([{ name: "café" }], "cafe\u0301"),
      ).toBe("café");
      expect(matchDirectoryEntry([{ name: "Billing" }], "billing")).toBe(
        "Billing",
      );
    });
  });
});
