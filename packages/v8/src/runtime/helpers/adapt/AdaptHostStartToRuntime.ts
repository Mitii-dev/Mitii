import {
  runtimeStartInputSchema,
  type RuntimeStartInput,
} from "../../contracts/input/RuntimeStartInput";

/**
 * Loose host / AgentEngineStartInput-shaped bag accepted by the runtime shell.
 * Keep fields optional — hosts grow additively.
 */
export interface HostStartLoose {
  runId?: string;
  message?: string;
  mode?: string;
  contextWindowTokens?: number;
  dirtyPaths?: string[];
  requiredSkillIds?: string[];
  requiredMcpServerIds?: string[];
  mcpServerIds?: string[];
  turnKind?: RuntimeStartInput["turnKind"];
  request?: {
    userMessage?: string;
    mode?: string;
    conversation?: Array<{ role?: string; content?: string }>;
    sessionId?: string;
  };
  conversation?: Array<{ role?: string; content?: string }>;
  workspaceRoot?: string;
  host?: RuntimeStartInput["host"];
  history?: RuntimeStartInput["history"];
  git?: RuntimeStartInput["git"];
  memory?: RuntimeStartInput["memory"];
  catalog?: RuntimeStartInput["catalog"];
  impact?: RuntimeStartInput["impact"];
  /** Engine windowBudget.maximumOutputTokens / context hints. */
  windowBudget?: {
    maximumOutputTokens?: number;
    effort?: string;
  };
  /** Focused editor path when host sends it under instructions / extras. */
  focusedFile?: string;
  cwd?: string;
  selection?: RuntimeStartInput["host"] extends infer H
    ? H extends { selection?: infer S }
      ? S
      : never
    : never;
}

function extractMessage(input: HostStartLoose): string {
  const fromConversation = (
    input.request?.conversation ?? input.conversation
  )
    ?.filter((m) => m.role === "user" && typeof m.content === "string")
    .map((m) => m.content as string)
    .join("\n")
    .trim();

  return (
    (typeof input.message === "string" && input.message.trim()) ||
    (typeof input.request?.userMessage === "string" &&
      input.request.userMessage.trim()) ||
    fromConversation ||
    ""
  );
}

function extractMode(input: HostStartLoose): "ask" | "plan" | "agent" {
  const rawMode = input.mode ?? input.request?.mode ?? "agent";
  return rawMode === "ask" || rawMode === "plan" || rawMode === "agent"
    ? rawMode
    : "agent";
}

function digestConversation(
  conversation: Array<{ role?: string; content?: string }> | undefined,
): RuntimeStartInput["history"] | undefined {
  if (!conversation || conversation.length === 0) return undefined;
  const userTurns = conversation.filter((m) => m.role === "user").length;
  const tail = conversation
    .slice(-4)
    .map((m) => `${m.role ?? "?"}: ${(m.content ?? "").slice(0, 120)}`)
    .join(" | ");
  return {
    compactedTurns: userTurns,
    digest: tail.slice(0, 2000),
  };
}

/**
 * Map host/SDK/engine start bags → RuntimeStartInput (HOST wiring foundation).
 */
export function adaptHostStartToRuntime(
  input: HostStartLoose,
): RuntimeStartInput & { mode: "ask" | "plan" | "agent" } {
  const message = extractMessage(input);
  const mode = extractMode(input);
  const dirtyPaths = input.dirtyPaths ?? input.host?.dirtyPaths ?? [];
  const focusedFile = input.host?.focusedFile ?? input.focusedFile;
  const cwd = input.host?.cwd ?? input.cwd ?? input.workspaceRoot;
  const selection = input.host?.selection ?? input.selection;

  const hasHost = Boolean(
    focusedFile ||
      cwd ||
      dirtyPaths.length > 0 ||
      selection ||
      input.host?.diagnostics?.length,
  );

  const history =
    input.history ??
    digestConversation(input.request?.conversation ?? input.conversation);

  const contextWindowTokens =
    input.contextWindowTokens ??
    (typeof input.windowBudget?.maximumOutputTokens === "number" &&
    input.windowBudget.maximumOutputTokens > 8_000
      ? input.windowBudget.maximumOutputTokens * 4
      : undefined);

  const start = runtimeStartInputSchema.parse({
    runId: input.runId,
    message: message.length > 0 ? message : "(empty)",
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(input.requiredSkillIds?.length
      ? { requiredSkillIds: input.requiredSkillIds }
      : {}),
    ...(input.requiredMcpServerIds?.length || input.mcpServerIds?.length
      ? {
          requiredMcpServerIds:
            input.requiredMcpServerIds ?? input.mcpServerIds,
          mcpServerIds: input.mcpServerIds ?? input.requiredMcpServerIds,
        }
      : {}),
    ...(hasHost
      ? {
          host: {
            focusedFile,
            cwd,
            dirtyPaths,
            diagnostics: input.host?.diagnostics ?? [],
            selection,
          },
        }
      : dirtyPaths.length > 0
        ? { host: { dirtyPaths, diagnostics: [] } }
        : {}),
    ...(history ? { history } : {}),
    ...(input.git ? { git: input.git } : {}),
    ...(input.memory ? { memory: input.memory } : {}),
    ...(input.catalog ? { catalog: input.catalog } : {}),
    ...(input.impact ? { impact: input.impact } : {}),
    ...(input.turnKind ? { turnKind: input.turnKind } : {}),
  });

  return { ...start, mode };
}

/** @deprecated Prefer adaptHostStartToRuntime — kept for bridge call sites. */
export function adaptAgentStartMessage(input: HostStartLoose): {
  message: string;
  mode: "ask" | "plan" | "agent";
  contextWindowTokens?: number;
  runId?: string;
} {
  const adapted = adaptHostStartToRuntime(input);
  return {
    message: adapted.message,
    mode: adapted.mode,
    contextWindowTokens: adapted.contextWindowTokens,
    runId: adapted.runId,
  };
}
