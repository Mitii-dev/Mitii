import { describe, expect, it } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryNetworkAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  directory,
  file,
  fingerprintToolCall,
} from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";

const WORKSPACE = "/workspace";

describe("network and mutating command tools", () => {
  it("fetch_url succeeds with NetworkPort and granted host", async () => {
    const runtime = new ToolRuntimePipeline({
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
        body: "<html><body>Hello docs</body></html>",
        headers: { "content-type": "text/html" },
      })),
    });

    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "n1",
      toolName: "fetch_url",
      arguments: { url: "https://docs.example.com/guide" },
      grant: createReadOnlyGrant({
        allowedTools: ["fetch_url"],
        allowedEffects: ["network_access"],
        networkHosts: ["docs.example.com"],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    expect((result.output as { status: number }).status).toBe(200);
    expect((result.output as { body: string }).body).toContain("Hello docs");
  });

  it("fetch_docs strips html noise", async () => {
    const runtime = new ToolRuntimePipeline({
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
        body: "<html><script>evil()</script><p>API Reference</p></html>",
      })),
    });

    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "d1",
      toolName: "fetch_docs",
      arguments: { url: "https://docs.example.com/api" },
      grant: createReadOnlyGrant({
        allowedTools: ["fetch_docs"],
        allowedEffects: ["network_access"],
        networkHosts: ["docs.example.com"],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    const body = (result.output as { body: string }).body;
    expect(body).toContain("API Reference");
    expect(body).not.toContain("evil");
  });

  it("web_search uses host SearchPort without networkHosts", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(WORKSPACE, directory({})),
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
      search: {
        async search({ query }) {
          return {
            query,
            results: [
              {
                title: "Mitii docs",
                url: "https://example.com/mitii",
                snippet: "Agent runtime",
                source: "test",
              },
            ],
            truncated: false,
          };
        },
      },
    });

    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "s1",
      toolName: "web_search",
      arguments: { query: "mitii tools" },
      grant: createReadOnlyGrant({
        allowedTools: ["web_search"],
        allowedEffects: ["network_access"],
        networkHosts: [],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    expect(
      (result.output as { results: Array<{ title: string }> }).results[0]?.title,
    ).toBe("Mitii docs");
  });

  it("run_command executes when explicitly granted with prefixes + approval never", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(
        WORKSPACE,
        directory({ "package.json": file("{}") }),
      ),
      process: new InMemoryProcessAdapter(async (req) => ({
        exitCode: 0,
        stdout: `ran:${req.argv.join(" ")}`,
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    });

    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "c1",
      toolName: "run_command",
      arguments: { argv: ["npm", "test"] },
      grant: {
        maximumWorkspaceEffect: "write",
        allowedTools: ["run_command"],
        allowedEffects: ["workspace_write", "process_execute"],
        pathScopes: ["."],
        commandRules: [
          { prefixes: ["npm"], allowShellMetacharacters: false },
        ],
        networkHosts: [],
        approvalMode: "never",
        limits: {
          maxToolCalls: 8,
          maxWallTimeMs: 30_000,
          maxOutputBytes: 64_000,
          maxConcurrentTools: 1,
        },
      },
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    expect((result.output as { stdout: string }).stdout).toContain("npm test");
  });

  it("run_command requires approval when approvalMode is when_required", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(WORKSPACE, directory({})),
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    });

    const args = { argv: ["npm", "test"] };
    const rejected = await runtime.execute({
      schemaVersion: 1,
      callId: "c2",
      toolName: "run_command",
      arguments: args,
      grant: {
        maximumWorkspaceEffect: "write",
        allowedTools: ["run_command"],
        allowedEffects: ["workspace_write", "process_execute"],
        pathScopes: ["."],
        commandRules: [
          { prefixes: ["npm"], allowShellMetacharacters: false },
        ],
        approvalMode: "when_required",
        limits: {
          maxToolCalls: 8,
          maxWallTimeMs: 30_000,
          maxOutputBytes: 64_000,
        },
      },
      workspaceRoot: WORKSPACE,
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.reasonCode).toBe("approval_required");

    const approved = await runtime.execute(
      {
        schemaVersion: 1,
        callId: "c3",
        toolName: "run_command",
        arguments: args,
        grant: {
          maximumWorkspaceEffect: "write",
          allowedTools: ["run_command"],
          allowedEffects: ["workspace_write", "process_execute"],
          pathScopes: ["."],
          commandRules: [
            { prefixes: ["npm"], allowShellMetacharacters: false },
          ],
          approvalMode: "when_required",
          limits: {
            maxToolCalls: 8,
            maxWallTimeMs: 30_000,
            maxOutputBytes: 64_000,
          },
        },
        workspaceRoot: WORKSPACE,
      },
      {
        approval: {
          approvalId: "a1",
          fingerprint: fingerprintToolCall("run_command", args),
          decision: "approved",
        },
      },
    );
    expect(approved.status).toBe("succeeded");
  });

  it("read_package_scripts returns scripts map", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(
        WORKSPACE,
        directory({
          "package.json": file(
            JSON.stringify({
              scripts: { test: "vitest", build: "tsc" },
              packageManager: "pnpm@9",
            }),
          ),
        }),
      ),
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    });

    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "p1",
      toolName: "read_package_scripts",
      arguments: { path: "package.json" },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    const output = result.output as {
      scripts: Record<string, string>;
      packageManager?: string;
    };
    expect(output.scripts.test).toBe("vitest");
    expect(output.packageManager).toBe("pnpm@9");
  });
});
