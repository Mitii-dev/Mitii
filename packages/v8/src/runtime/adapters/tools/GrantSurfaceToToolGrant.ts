import type { ToolGrant } from "../../../modules/decision-policy";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";

/** Lift thin GrantSurface → ToolGrant defaults for ToolRuntimePipeline. */
export function grantSurfaceToToolGrant(surface: GrantSurface): ToolGrant {
  const maximumWorkspaceEffect = surface.maximumWorkspaceEffect ?? "read";
  const allowedTools = surface.allowedTools ?? [];
  const allowedEffects =
    surface.allowedEffects && surface.allowedEffects.length > 0
      ? (surface.allowedEffects as ToolGrant["allowedEffects"])
      : maximumWorkspaceEffect === "write"
        ? (["workspace_read", "workspace_write"] as ToolGrant["allowedEffects"])
        : (["workspace_read"] as ToolGrant["allowedEffects"]);

  const pathScopes =
    surface.pathScopes && surface.pathScopes.length > 0
      ? surface.pathScopes
      : surface.readPaths && surface.readPaths.length > 0
        ? surface.readPaths
        : ["."];

  return {
    maximumWorkspaceEffect,
    allowedTools,
    allowedEffects,
    pathScopes,
    approvalMode: surface.approvalMode ?? "never",
    limits: {
      maxToolCalls: 24,
      maxWallTimeMs: 90_000,
      maxOutputBytes: 256_000,
      maxConcurrentTools: 1,
    },
    networkHosts: [],
    ...(surface.readPaths || surface.writePaths
      ? {
          scopes: {
            readPaths: surface.readPaths ?? pathScopes,
            writePaths: surface.writePaths ?? [],
          },
        }
      : {}),
  };
}
