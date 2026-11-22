import { describe, expect, it } from "vitest";

import {
  CODE_NAVIGATION_OPERATIONS,
  CODE_NAVIGATION_REASON_CODES,
  CODE_NAVIGATION_SCHEMA_VERSION,
  CODE_NAVIGATION_STATUSES,
  CodeNavigationError,
  CodeNavigationPipeline,
  codeNavigationInputSchema,
  codeNavigationResultSchema,
} from "../../index";
import type { CodeNavigationPort } from "../../index";

describe("CodeNavigation contract", () => {
  it("accepts every public operation with a valid caret query", () => {
    for (const operation of CODE_NAVIGATION_OPERATIONS) {
      if (
        operation === "document_symbols" ||
        operation === "workspace_symbols"
      ) {
        continue;
      }
      const parsed = codeNavigationInputSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        operation,
        query: { relativePath: "src/auth.ts", line: 4, column: 2 },
      });
      expect(parsed.operation).toBe(operation);
      expect(parsed.maximumLocations).toBeGreaterThan(0);
    }
  });

  it("rejects empty relative paths with a stable error code", async () => {
    const pipeline = new CodeNavigationPipeline();
    await expect(
      pipeline.navigate({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        operation: "definition",
        query: { relativePath: "", line: 1 },
      } as never),
    ).rejects.toMatchObject({
      name: "CodeNavigationError",
      code: "invalid_input",
    });
    expect(CodeNavigationError.name).toBe("CodeNavigationError");
  });

  it("returns unavailable with port_unavailable when no port is injected", async () => {
    const pipeline = new CodeNavigationPipeline();
    const result = await pipeline.navigate(
      codeNavigationInputSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        operation: "definition",
        query: { relativePath: "src/auth.ts", line: 4 },
      }),
    );
    const parsed = codeNavigationResultSchema.parse(result);
    expect(CODE_NAVIGATION_STATUSES).toContain(parsed.status);
    expect(parsed.status).toBe("unavailable");
    expect(parsed.provider).toBe("none");
    expect(parsed.reasonCodes).toContain("port_unavailable");
    for (const code of parsed.reasonCodes) {
      expect(CODE_NAVIGATION_REASON_CODES).toContain(code);
    }
  });

  it("maps definition through the port into a resolved result shape", async () => {
    const port: CodeNavigationPort = {
      id: "stub",
      provider: "language_server",
      definition: async () => [
        {
          relativePath: "src/auth.ts",
          startLine: 4,
          startColumn: 17,
          endLine: 4,
          endColumn: 28,
          symbolName: "validateJwt",
          symbolKind: "function",
        },
      ],
      references: async () => [],
    };
    const pipeline = new CodeNavigationPipeline({ navigation: port });
    const result = await pipeline.navigate({
      schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
      operation: "definition",
      query: { relativePath: "src/auth.ts", line: 4, column: 10 },
    });
    const parsed = codeNavigationResultSchema.parse(result);
    expect(parsed.status).toBe("resolved");
    expect(parsed.operation).toBe("definition");
    expect(parsed.provider).toBe("language_server");
    expect(parsed.locations).toHaveLength(1);
    expect(parsed.locations[0]?.symbolName).toBe("validateJwt");
    expect(parsed.reasonCodes).toContain("definition_resolved");
    expect(parsed.truncated).toBe(false);
  });

  it("returns empty with no_locations when the port finds nothing", async () => {
    const port: CodeNavigationPort = {
      id: "empty",
      provider: "language_server",
      definition: async () => [],
      references: async () => [],
    };
    const pipeline = new CodeNavigationPipeline({ navigation: port });
    const result = await pipeline.navigate({
      schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
      operation: "references",
      query: { relativePath: "src/auth.ts", line: 4 },
    });
    expect(codeNavigationResultSchema.parse(result)).toMatchObject({
      status: "empty",
      reasonCodes: expect.arrayContaining(["no_locations"]),
    });
  });
});
