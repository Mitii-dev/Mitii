import type { TaskDirectionAssessment } from "../../contracts/assess/TaskDirectionAssessment";
import type { StepContext } from "./StepContext";

function pathFromFilesToReadEntry(
  entry: string | { path: string },
): string | undefined {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry.path === "string") return entry.path;
  return undefined;
}

/**
 * Step 4 — optional cheap peeks (max 3–5 files) before Decide (§5.12.10 / S2-READS).
 * Uses RuntimeToolExecutorPort when present; otherwise records pending_host.
 */
export async function fetchEphemeralPeeks(ctx: StepContext): Promise<void> {
  const assessment = ctx.store.getSlice<TaskDirectionAssessment>("assessment");
  const requested = (assessment?.filesToRead ?? [])
    .map(pathFromFilesToReadEntry)
    .filter((p): p is string => Boolean(p))
    .slice(0, 5);

  if (requested.length === 0) {
    ctx.store.setSlice("ephemeralPeeks", {
      requested: [],
      excerpts: [],
      status: "skipped",
      reasonCodes: ["peeks_none_requested"],
    });
    return;
  }

  const tools = ctx.deps?.tools;
  if (!tools) {
    ctx.store.setSlice("ephemeralPeeks", {
      requested,
      excerpts: [],
      status: "pending_host",
      reasonCodes: ["peeks_no_tool_port"],
    });
    return;
  }

  const excerpts: Array<{ path: string; text: string; ok: boolean }> = [];
  const reasonCodes = ["peeks_tool_read"];

  for (const path of requested) {
    try {
      const result = await tools.execute({
        toolId: "read_file",
        args: { path, maxBytes: 4_000 },
        grant: {
          maximumWorkspaceEffect: "read",
          allowedTools: ["read_file"],
          allowedEffects: ["workspace_read"],
          pathScopes: ["."],
        },
        invocationId: `peek_${path.replace(/[^\w.-]+/g, "_").slice(0, 48)}`,
      });
      const text =
        typeof result.output === "string"
          ? result.output.slice(0, 4_000)
          : result.output != null
            ? JSON.stringify(result.output).slice(0, 4_000)
            : "";
      excerpts.push({ path, text, ok: result.ok });
      if (!result.ok) {
        reasonCodes.push(result.reasonCode ?? "peek_read_failed");
      }
    } catch {
      excerpts.push({ path, text: "", ok: false });
      reasonCodes.push("peek_read_threw");
    }
  }

  ctx.store.setSlice("ephemeralPeeks", {
    requested,
    excerpts,
    status: excerpts.some((e) => e.ok) ? "ok" : "failed",
    reasonCodes,
  });
}
