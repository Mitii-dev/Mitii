import { describe, expect, it } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryNetworkAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  directory,
  file,
} from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";

const WORKSPACE = "/workspace";

describe("P2 fetch policy + directory_tree + read head/tail", () => {
  it("blocks autonomous fetch when robots.txt disallows the path", async () => {
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
      network: new InMemoryNetworkAdapter((url) => {
        if (url.endsWith("/robots.txt")) {
          return {
            status: 200,
            body: "User-agent: *\nDisallow: /secret\n",
          };
        }
        return { status: 200, body: "should-not-fetch" };
      }),
    });

    const denied = await runtime.execute({
      schemaVersion: 1,
      callId: "r1",
      toolName: "fetch_url",
      arguments: {
        url: "https://docs.example.com/secret",
        intent: "autonomous",
      },
      grant: createReadOnlyGrant({
        allowedTools: ["fetch_url"],
        allowedEffects: ["network_access"],
        networkHosts: ["docs.example.com"],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(denied.status).toBe("rejected");

    const allowed = await runtime.execute({
      schemaVersion: 1,
      callId: "r2",
      toolName: "fetch_url",
      arguments: {
        url: "https://docs.example.com/secret",
        intent: "user",
      },
      grant: createReadOnlyGrant({
        allowedTools: ["fetch_url"],
        allowedEffects: ["network_access"],
        networkHosts: ["docs.example.com"],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(allowed.status).toBe("succeeded");
    expect((allowed.output as { body: string }).body).toBe("should-not-fetch");
  });

  it("read_file head and tail windows", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(
        WORKSPACE,
        directory({
          "log.txt": file("l1\nl2\nl3\nl4\nl5\n"),
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
    const grant = createReadOnlyGrant({
      allowedTools: ["read_file"],
      allowedEffects: ["workspace_read"],
      pathScopes: ["."],
    });

    const head = await runtime.execute({
      schemaVersion: 1,
      callId: "h1",
      toolName: "read_file",
      arguments: { path: "log.txt", head: 2 },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(head.status).toBe("succeeded");
    expect((head.output as { content: string }).content).toContain("l1");
    expect((head.output as { endLine: number }).endLine).toBe(2);

    const tail = await runtime.execute({
      schemaVersion: 1,
      callId: "t1",
      toolName: "read_file",
      arguments: { path: "log.txt", tail: 2 },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(tail.status).toBe("succeeded");
    expect((tail.output as { content: string }).content).toContain("l5");
    expect((tail.output as { startLine: number }).startLine).toBeGreaterThan(1);
  });

  it("directory_tree returns nested structure and skips node_modules", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(
        WORKSPACE,
        directory({
          src: directory({
            "a.ts": file("export {};\n"),
            nested: directory({
              "b.ts": file("export {};\n"),
            }),
          }),
          node_modules: directory({
            pkg: directory({ "index.js": file("1") }),
          }),
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
      callId: "d1",
      toolName: "directory_tree",
      arguments: { path: ".", maxDepth: 5 },
      grant: createReadOnlyGrant({
        allowedTools: ["directory_tree"],
        allowedEffects: ["workspace_read"],
        pathScopes: ["."],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    const tree = (result.output as { tree: Array<{ name: string }> }).tree;
    expect(tree.some((n) => n.name === "src")).toBe(true);
    expect(tree.some((n) => n.name === "node_modules")).toBe(false);
  });
});
