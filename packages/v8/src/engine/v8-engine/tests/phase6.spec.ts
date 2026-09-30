import { describe, expect, it } from "vitest";

import {
  DESCRIBE_TOOL_NAME,
  FULL_SCHEMA_TOOL_IDS,
  TOOL_INDEX_INPUT_SCHEMA,
  filterToolDefinitions,
  toToolIndexDefinition,
} from "../actions/progressiveTools";
import { resolveV8LoopPolicyThresholds } from "../policy/bands";
import { V8_ENGINE_THRESHOLDS } from "../policy";
import {
  resolveShapedDiscoveryProfile,
  SHAPED_DISCOVERY_PROFILES,
} from "../actions/shapedDiscovery";

describe("progressive INDEX stubs parity", () => {
  it("keeps core tools full-schema and stubs long-tail", () => {
    expect(FULL_SCHEMA_TOOL_IDS.has("read_file")).toBe(true);
    expect(FULL_SCHEMA_TOOL_IDS.has("apply_patch")).toBe(true);
    expect(FULL_SCHEMA_TOOL_IDS.has(DESCRIBE_TOOL_NAME)).toBe(true);

    const stubbed = toToolIndexDefinition({
      name: "some_long_tail_tool",
      description: "x".repeat(200),
      inputSchema: {
        type: "object",
        properties: { q: { type: "string" } },
        required: ["q"],
      },
    });
    expect(stubbed.inputSchema).toEqual(TOOL_INDEX_INPUT_SCHEMA);
    expect(stubbed.description.endsWith("…")).toBe(true);
  });

  it("filterToolDefinitions always includes describe_tool when tools granted", () => {
    const tools = filterToolDefinitions({
      grant: {
        allowedTools: ["read_file", DESCRIBE_TOOL_NAME],
        maximumWorkspaceEffect: "read",
        pathScopes: ["**"],
      } as never,
      definitions: [
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: DESCRIBE_TOOL_NAME,
          description: "Hydrate schema",
          inputSchema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      ],
      supportsTools: true,
      mode: "agent",
    });
    expect(tools.some((t) => t.name === DESCRIBE_TOOL_NAME)).toBe(true);
    expect(tools.find((t) => t.name === "read_file")?.inputSchema).not.toEqual(
      TOOL_INDEX_INPUT_SCHEMA,
    );
  });
});

describe("v8 loop policy bands", () => {
  it("applies compact band overrides onto base thresholds", () => {
    const resolved = resolveV8LoopPolicyThresholds({
      contextWindowTokens: 35_000,
    });
    expect(resolved.band).toBe("compact");
    expect(resolved.thresholds.maxReadOnlyTurnsBeforeMutationNudge).toBe(15);
    expect(resolved.thresholds.toolLoopSoftIdentical).toBe(
      V8_ENGINE_THRESHOLDS.toolLoopSoftIdentical,
    );
  });

  it("merges host overrides after band", () => {
    const resolved = resolveV8LoopPolicyThresholds({
      contextWindowTokens: 75_000,
      overrides: { maxContinueOverrides: 9 },
    });
    expect(resolved.band).toBe("standard");
    expect(resolved.thresholds.maxContinueOverrides).toBe(9);
  });
});

describe("shaped discovery Phase 6 profiles", () => {
  it("resolves monorepo and security queries", () => {
    expect(SHAPED_DISCOVERY_PROFILES.length).toBeGreaterThanOrEqual(10);
    expect(resolveShapedDiscoveryProfile("fix pnpm workspace turbo build")?.id).toBe(
      "monorepo",
    );
    expect(resolveShapedDiscoveryProfile("patch XSS in the form handler")?.id).toBe(
      "security",
    );
  });
});
