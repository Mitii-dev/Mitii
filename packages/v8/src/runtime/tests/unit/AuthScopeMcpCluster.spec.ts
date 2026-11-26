import { describe, expect, it } from "vitest";

import { runtimeResumeInputSchema } from "../../contracts/input/RuntimeResumeInput";
import { buildScopeVerdict } from "../../helpers/orient/BuildScopeVerdict";
import { scopesFromVerdict } from "../../helpers/grant/ScopesFromVerdict";
import {
  evaluateGates,
  resumeAuthOrDependency,
} from "../../helpers/gates";
import { compileGrantFromPlate } from "../../../modules/decision-policy";
import { situationPackSchema } from "../../contracts/orient/SituationPack";

describe("S10-EXT-AUTH", () => {
  it("suspends mid_loop when auth missing + extended", () => {
    const verdict = evaluateGates("mid_loop", {
      runId: "r1",
      authOrDependencyMissing: true,
      enableExtendedGates: true,
    });
    expect(verdict?.kind).toBe("auth_or_dependency_required");
  });

  it("resumeAuthOrDependency maps connected / skip / cancel", () => {
    expect(resumeAuthOrDependency({ action: "connected" }).replayTool).toBe(
      true,
    );
    expect(resumeAuthOrDependency({ action: "skip_fallback" }).reenter).toBe(
      "loop",
    );
    expect(resumeAuthOrDependency({ action: "cancel" }).terminal).toBe(
      "cancelled",
    );
  });

  it("resume input accepts auth target + authAction", () => {
    const parsed = runtimeResumeInputSchema.parse({
      runId: "r1",
      decision: "approve",
      target: "auth",
      authAction: "connected",
    });
    expect(parsed.target).toBe("auth");
    expect(parsed.authAction).toBe("connected");
  });
});

describe("S2-SCOPE protectedPaths", () => {
  it("flows protectedPaths from verdict into grant scopes", () => {
    const verdict = buildScopeVerdict({
      message: "explain the app",
      focusPaths: ["src/app.ts"],
      protectedPaths: [".env", "secrets/"],
    });
    expect(verdict.protectedPaths).toEqual([".env", "secrets/"]);
    const scopes = scopesFromVerdict(verdict);
    expect(scopes.scopes.protectedPaths).toEqual([".env", "secrets/"]);
    expect(scopes.reasonCodes).toContain("scopes_verdict_protected_paths");

    const grant = compileGrantFromPlate({
      grantProfile: "research",
      pathScopes: scopes.pathScopes,
      protectedPathGlobs: scopes.scopes.protectedPaths,
    });
    expect(grant.toolGrant.protectedPathGlobs).toEqual([".env", "secrets/"]);
    expect(grant.toolGrant.scopes?.protectedPaths).toEqual([
      ".env",
      "secrets/",
    ]);
    expect(grant.reasonCodes).toContain("grant_protected_paths_applied");
  });
});

describe("S1-MCP-RULES structured pins", () => {
  it("accepts mcp/project/safety attachments on SituationPack", () => {
    const pack = situationPackSchema.parse({
      schemaVersion: 1,
      request: { text: "query db", mode: "agent" },
      requestText: "query db",
      mode: "agent",
      scope: {
        focusPaths: [],
        relatedSeeds: [],
        evidence: "focus_only",
      },
      pins: {
        skillIds: [],
        mcpIds: ["mongo"],
        projectRules: ["rule.repo"],
        userSafetyRules: ["safety.secrets"],
        mcpAttachments: [
          { serverId: "mongo", summary: "Read-only MongoDB", required: true },
        ],
        projectRuleAttachments: [
          { id: "rule.repo", summary: "Prefer pnpm" },
        ],
        userSafetyRuleAttachments: [
          { id: "safety.secrets", summary: "Never commit .env" },
        ],
      },
    });
    expect(pack.pins?.mcpAttachments?.[0]?.serverId).toBe("mongo");
    expect(pack.pins?.projectRuleAttachments?.[0]?.id).toBe("rule.repo");
  });
});
