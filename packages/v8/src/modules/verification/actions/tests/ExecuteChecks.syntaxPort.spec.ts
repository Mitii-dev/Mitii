import { describe, expect, it, vi } from "vitest";

import { SYNTAX_PORT_EVIDENCE } from "../../contracts";
import type {
  VerificationSyntaxPort,
  VerificationToolExecutorPort,
} from "../../contracts";
import type { DiscoveredCheckCandidate } from "../../internal/discovery";
import { createVerificationGrant } from "../../tests/fixtures/grants";
import { executeChecks } from "../ExecuteChecks";

const pinnedState = {
  workspaceId: "ws-1",
  stateToken: "tok",
};

const syntaxCandidate: DiscoveredCheckCandidate = {
  checkId: "syntax:port",
  kind: "syntax",
  label: "Tree-sitter syntax check",
  evidenceSource: SYNTAX_PORT_EVIDENCE,
  toolName: "run_readonly_command",
  toolArguments: { paths: ["src/broken.py"] },
  languageId: "python",
};

describe("executeChecks — VerificationSyntaxPort", () => {
  it("runs the syntax port without Tool Runtime when evidence is port:syntax", async () => {
    const tools: VerificationToolExecutorPort = {
      execute: vi.fn(async () => {
        throw new Error("tools.execute must not be called for syntax port");
      }),
    };
    const syntax: VerificationSyntaxPort = {
      checkFiles: vi.fn(async () => ({
        findings: [
          {
            path: "src/broken.py",
            startLine: 2,
            startColumn: 1,
            message: 'Syntax error near "def"',
          },
        ],
      })),
    };

    const result = await executeChecks({
      candidates: [syntaxCandidate],
      grant: createVerificationGrant({ allowedTools: [] }),
      workspaceRoot: "/tmp/ws",
      pinnedState,
      tools,
      syntax,
    });

    expect(tools.execute).not.toHaveBeenCalled();
    expect(syntax.checkFiles).toHaveBeenCalled();
    expect(result.checks[0]?.outcome).toBe("failed");
    expect(result.toolOutputs.get("verify-1-syntax:port")).toEqual(
      expect.objectContaining({
        findings: [
          expect.objectContaining({ path: "src/broken.py", startLine: 2 }),
        ],
      }),
    );
  });

  it("marks syntax:port unavailable when the port is not configured", async () => {
    const tools: VerificationToolExecutorPort = {
      execute: vi.fn(async () => ({
        status: "succeeded",
        output: {},
      })),
    };

    const result = await executeChecks({
      candidates: [syntaxCandidate],
      grant: createVerificationGrant(),
      workspaceRoot: "/tmp/ws",
      pinnedState,
      tools,
    });

    expect(result.checks[0]?.outcome).toBe("unavailable");
    expect(tools.execute).not.toHaveBeenCalled();
  });

  it("passes when the syntax port reports no findings", async () => {
    const tools: VerificationToolExecutorPort = {
      execute: vi.fn(async () => ({
        status: "succeeded",
        output: {},
      })),
    };
    const syntax: VerificationSyntaxPort = {
      checkFiles: vi.fn(async () => ({ findings: [] })),
    };

    const result = await executeChecks({
      candidates: [syntaxCandidate],
      grant: createVerificationGrant(),
      workspaceRoot: "/tmp/ws",
      pinnedState,
      tools,
      syntax,
    });

    expect(result.checks[0]?.outcome).toBe("passed");
  });
});
