import type { ToolGrant } from "../../../modules/decision-policy";
import { DEFAULT_AGENT_READONLY_COMMAND_PREFIXES } from "../../../modules/decision-policy";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";

const PROCESS_TOOLS = new Set(["run_readonly_command", "run_command"]);

/** Lift thin GrantSurface → ToolGrant defaults for ToolRuntimePipeline. */
export function grantSurfaceToToolGrant(surface: GrantSurface): ToolGrant {
  const maximumWorkspaceEffect = surface.maximumWorkspaceEffect ?? "read";
  const allowedTools = surface.allowedTools ?? [];
  const wantsProcess = allowedTools.some((tool) => PROCESS_TOOLS.has(tool));
  const baseEffects =
    surface.allowedEffects && surface.allowedEffects.length > 0
      ? ([...surface.allowedEffects] as ToolGrant["allowedEffects"])
      : maximumWorkspaceEffect === "write"
        ? (["workspace_read", "workspace_write"] as ToolGrant["allowedEffects"])
        : (["workspace_read"] as ToolGrant["allowedEffects"]);
  const allowedEffects =
    wantsProcess && !baseEffects.includes("process_execute")
      ? ([...baseEffects, "process_execute"] as ToolGrant["allowedEffects"])
      : baseEffects;

  const pathScopes =
    surface.pathScopes && surface.pathScopes.length > 0
      ? surface.pathScopes
      : surface.readPaths && surface.readPaths.length > 0
        ? surface.readPaths
        : ["."];

  const fromSurface = (surface.commandRules ?? [])
    .map((rule) => ({
      prefixes: [...rule.prefixes].filter((prefix) => prefix.trim().length > 0),
      allowShellMetacharacters: rule.allowShellMetacharacters === true,
      ...(typeof rule.maxOutputBytes === "number"
        ? { maxOutputBytes: rule.maxOutputBytes }
        : {}),
    }))
    .filter((rule) => rule.prefixes.length > 0);

  const commandRules =
    fromSurface.length > 0
      ? fromSurface
      : wantsProcess
        ? [
            {
              prefixes: [...DEFAULT_AGENT_READONLY_COMMAND_PREFIXES],
              allowShellMetacharacters: false,
            },
          ]
        : undefined;

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
    ...(commandRules ? { commandRules } : {}),
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
