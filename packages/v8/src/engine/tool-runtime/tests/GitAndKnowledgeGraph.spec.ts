import { describe, expect, it } from "vitest";

import {
  InMemoryKnowledgeGraphStore,
  KnowledgeGraphManager,
} from "../../../modules/memory";
import {
  InMemoryFileSystemAdapter,
  InMemoryGitAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  directory,
} from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";

const WORKSPACE = "/workspace";

function createWriteGrant(
  overrides: Parameters<typeof createReadOnlyGrant>[0] = {},
) {
  return createReadOnlyGrant({
    maximumWorkspaceEffect: "write",
    allowedEffects: ["workspace_read", "workspace_write"],
    ...overrides,
  });
}

function createRuntime(knowledgeGraph?: KnowledgeGraphManager) {
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
    git: new InMemoryGitAdapter(
      {
        branch: "main",
        staged: [],
        unstaged: [],
        untracked: [],
        raw: "",
      },
      { diff: "", truncated: false },
      {
        entries: [
          {
            hash: "abc1234",
            subject: "feat: billing",
            authorName: "Dev",
          },
        ],
        truncated: false,
      },
      {
        revision: "abc1234",
        content: "diff --git a/x b/x",
        truncated: false,
      },
      {
        current: "main",
        branches: ["main", "feature/billing"],
        truncated: false,
      },
    ),
    ...(knowledgeGraph ? { knowledgeGraph } : {}),
  });
}

describe("P1 git + knowledge graph tools", () => {
  it("read_git_log / show / branches succeed via GitPort", async () => {
    const runtime = createRuntime();
    const grant = createReadOnlyGrant({
      allowedTools: [
        "read_git_log",
        "read_git_show",
        "read_git_branches",
      ],
      allowedEffects: ["workspace_read"],
    });

    const log = await runtime.execute({
      schemaVersion: 1,
      callId: "g1",
      toolName: "read_git_log",
      arguments: { maxCount: 5 },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(log.status).toBe("succeeded");
    expect(
      (log.output as { entries: { subject: string }[] }).entries[0]?.subject,
    ).toContain("billing");

    const show = await runtime.execute({
      schemaVersion: 1,
      callId: "g2",
      toolName: "read_git_show",
      arguments: { revision: "abc1234" },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(show.status).toBe("succeeded");

    const branches = await runtime.execute({
      schemaVersion: 1,
      callId: "g3",
      toolName: "read_git_branches",
      arguments: {},
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(
      (branches.output as { branches: string[] }).branches,
    ).toContain("feature/billing");
  });

  it("memory_graph tools create, search, and honest-delete", async () => {
    const kg = new KnowledgeGraphManager(new InMemoryKnowledgeGraphStore());
    const runtime = createRuntime(kg);

    const write = await runtime.execute({
      schemaVersion: 1,
      callId: "m1",
      toolName: "memory_graph_update",
      arguments: {
        operation: "create_entities",
        entities: [
          {
            name: "Alice",
            entityType: "person",
            observations: ["owns billing"],
          },
        ],
      },
      grant: createWriteGrant({
        allowedTools: ["memory_graph_update"],
        allowedEffects: ["workspace_write"],
        pathScopes: ["."],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(write.status).toBe("succeeded");

    const search = await runtime.execute({
      schemaVersion: 1,
      callId: "m2",
      toolName: "memory_graph_search",
      arguments: { query: "billing" },
      grant: createReadOnlyGrant({
        allowedTools: ["memory_graph_search"],
        allowedEffects: ["workspace_read"],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(search.status).toBe("succeeded");
    expect(
      (search.output as { entities: { name: string }[] }).entities[0]?.name,
    ).toBe("Alice");

    const del = await runtime.execute({
      schemaVersion: 1,
      callId: "m3",
      toolName: "memory_graph_update",
      arguments: {
        operation: "delete_entities",
        names: ["Alice", "Ghost"],
      },
      grant: createWriteGrant({
        allowedTools: ["memory_graph_update"],
        allowedEffects: ["workspace_write"],
        pathScopes: ["."],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(del.status).toBe("succeeded");
    const result = (
      del.output as { result: { deleted: string[]; notFound: string[] } }
    ).result;
    expect(result.deleted).toEqual(["Alice"]);
    expect(result.notFound).toEqual(["Ghost"]);
  });
});
