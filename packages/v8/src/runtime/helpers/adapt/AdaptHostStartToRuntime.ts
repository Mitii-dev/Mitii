import {
  runtimeStartInputSchema,
  type RuntimeStartInput,
} from "../../contracts/input/RuntimeStartInput";
import type { RuntimeSituationSnapshot } from "../../contracts/input/RuntimeSituationSnapshot";

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
  runtimeSituation?: RuntimeSituationSnapshot;
  instructions?: {
    projectRules?: Array<{ id: string; content?: string }>;
  };
  userSafetyRules?: unknown;
  windowBudget?: {
    maximumOutputTokens?: number;
    effort?: string;
  };
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
 * Map host/SDK/engine start bags → RuntimeStartInput (HOST wiring).
 */
export function adaptHostStartToRuntime(
  input: HostStartLoose,
): RuntimeStartInput & { mode: "ask" | "plan" | "agent" } {
  const situation = input.runtimeSituation;
  const message = extractMessage(input);
  const mode = extractMode(input);

  const dirtyPaths = [
    ...(input.dirtyPaths ?? []),
    ...(input.host?.dirtyPaths ?? []),
    ...(situation?.host?.dirtyPaths ?? []),
  ];
  const uniqueDirty = [...new Set(dirtyPaths.filter((p) => p.length > 0))];

  const focusedFile =
    situation?.host?.focusedFile ??
    input.host?.focusedFile ??
    input.focusedFile;
  const cwd =
    situation?.host?.cwd ??
    input.host?.cwd ??
    input.cwd ??
    input.workspaceRoot;
  const selection =
    situation?.host?.selection ?? input.host?.selection ?? input.selection;
  const diagnostics =
    situation?.host?.diagnostics ?? input.host?.diagnostics ?? [];

  const hasHost = Boolean(
    focusedFile ||
      cwd ||
      uniqueDirty.length > 0 ||
      selection ||
      diagnostics.length > 0,
  );

  const history =
    input.history ??
    digestConversation(input.request?.conversation ?? input.conversation);

  const git = situation?.git ?? input.git;
  const memory = situation?.memory ?? input.memory;
  const catalog = situation?.catalog ?? input.catalog;
  const impact = situation?.impact ?? input.impact;

  const contextWindowTokens =
    input.contextWindowTokens ??
    (typeof input.windowBudget?.maximumOutputTokens === "number" &&
    input.windowBudget.maximumOutputTokens > 8_000
      ? input.windowBudget.maximumOutputTokens * 4
      : undefined);

  const projectRuleIds = [
    ...(situation?.projectRuleIds ?? []),
    ...(input.instructions?.projectRules ?? []).map((r) => r.id),
  ].filter((id, i, all) => id.length > 0 && all.indexOf(id) === i);

  const userSafetyRuleIds = extractUserSafetyRuleIds(input.userSafetyRules);

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
            dirtyPaths: uniqueDirty,
            diagnostics,
            selection,
          },
        }
      : {}),
    ...(history ? { history } : {}),
    ...(git ? { git } : {}),
    ...(memory ? { memory } : {}),
    ...(catalog ? { catalog } : {}),
    ...(impact ? { impact } : {}),
    ...(projectRuleIds.length > 0 ? { projectRuleIds } : {}),
    ...(userSafetyRuleIds.length > 0 ? { userSafetyRuleIds } : {}),
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

function extractUserSafetyRuleIds(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const rules = raw as {
    enabled?: boolean;
    denyTools?: unknown;
    denyCommandPrefixes?: unknown;
    denyPathScopes?: unknown;
    protectedPathGlobs?: unknown;
  };
  if (rules.enabled === false) return [];
  const ids: string[] = [];
  const pushAll = (prefix: string, values: unknown) => {
    if (!Array.isArray(values)) return;
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        ids.push(`${prefix}:${value.trim()}`);
      }
    }
  };
  pushAll("denyTool", rules.denyTools);
  pushAll("denyCmd", rules.denyCommandPrefixes);
  pushAll("denyPath", rules.denyPathScopes);
  pushAll("protect", rules.protectedPathGlobs);
  return [...new Set(ids)].slice(0, 32);
}
