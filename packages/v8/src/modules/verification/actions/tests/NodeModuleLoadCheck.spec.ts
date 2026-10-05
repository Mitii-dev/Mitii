import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_VERIFICATION_COMMAND_PREFIXES } from "../../../decision-policy";
import { NODE_MODULE_LOAD_EVIDENCE } from "../../contracts";
import {
  buildNodeModuleLoadArgv,
  syntaxCandidatesForChangedFiles,
} from "../../internal/discovery/syntaxCandidates";
import { createVerificationGrant } from "../../tests/fixtures/grants";
import { executeChecks } from "../ExecuteChecks";
import { selectProportionalChecks } from "../SelectProportionalChecks";

const pinnedState = {
  workspaceId: "ws-modload",
  stateToken: "tok",
};

describe("Node module-load verification gate", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds non-empty -e argv under the node verification prefix", () => {
    const argv = buildNodeModuleLoadArgv(["src/index.js"]);
    expect(argv).toEqual([
      "node",
      "--import",
      "./src/index.js",
      "-e",
      "void 0",
    ]);
    expect(argv.every((part) => part.length > 0)).toBe(true);
    expect(DEFAULT_VERIFICATION_COMMAND_PREFIXES).toContain("node");
  });

  it("selects module-load over tree-sitter and fails on duplicate export", async () => {
    const root = mkdtempSync(join(tmpdir(), "mitii-modload-"));
    dirs.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "modload", type: "module" }),
      "utf8",
    );
    writeFileSync(
      join(root, "index.js"),
      "export function apiKeyMiddleware() {}\nexport { apiKeyMiddleware };\n",
      "utf8",
    );

    const candidates = syntaxCandidatesForChangedFiles({
      projectId: "workspace-root",
      languageId: "javascript",
      projectRoot: ".",
      changedFiles: ["index.js"],
    });
    const selected = selectProportionalChecks({
      candidates: [
        ...candidates,
        {
          checkId: "syntax:port",
          kind: "syntax",
          label: "Tree-sitter syntax check",
          evidenceSource: "port:syntax",
          languageId: "unknown",
          toolName: "run_readonly_command",
          toolArguments: {},
        },
      ],
      verification: {
        required: true,
        minimumEvidence: [],
        allowUnavailable: true,
      },
      changeScope: "localized",
      maxChecks: 4,
      changedFiles: ["index.js"],
    }).selected;

    expect(selected[0]?.evidenceSource).toBe(NODE_MODULE_LOAD_EVIDENCE);

    const moduleLoad = selected.filter(
      (c) => c.evidenceSource === NODE_MODULE_LOAD_EVIDENCE,
    );
    const grant = createVerificationGrant();
    const result = await executeChecks({
      candidates: moduleLoad,
      grant,
      workspaceRoot: root,
      pinnedState,
      tools: {
        async execute(input) {
          const argv = (input.arguments as { argv?: string[] }).argv;
          if (!argv || argv.length === 0) {
            return {
              status: "failed" as const,
              output: {
                argv: [],
                exitCode: 1,
                stdout: "",
                stderr: "missing argv",
                truncated: false,
              },
              warnings: [],
            };
          }
          // Grant must allow `node` or verification never runs this gate.
          expect(grant.commandRules?.[0]?.prefixes).toContain("node");
          const child = spawnSync(argv[0]!, argv.slice(1), {
            cwd: input.workspaceRoot,
            encoding: "utf8",
            env: {
              ...process.env,
              MITII_NO_LISTEN: "1",
            },
            timeout: 10_000,
          });
          return {
            status:
              child.status === 0 ? ("succeeded" as const) : ("failed" as const),
            output: {
              argv,
              exitCode: child.status,
              stdout: child.stdout ?? "",
              stderr: child.stderr ?? "",
              truncated: false,
            },
            warnings: [],
          };
        },
      },
    });

    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.outcome).toBe("failed");
    const evidence = `${result.checks[0]?.summary ?? ""}\n${JSON.stringify(
      [...result.toolOutputs.values()],
    )}`;
    expect(evidence).toMatch(/Duplicate export|SyntaxError|exit 1/i);
  });
});
