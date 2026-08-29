import type { MemoryFactType } from "../contracts";

export interface SyntheticObservationInput {
  toolName?: string;
  hookType?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  userPrompt?: string;
}

export interface SyntheticObservation {
  type: MemoryFactType;
  title: string;
  content: string;
  files: string[];
  concepts: string[];
  importance: number;
  promotable: boolean;
}

/**
 * Heuristic observation → durable-memory draft. No model call.
 * Hosts decide whether to persist the raw observation; this only
 * proposes a commit when the event looks like a lasting preference or bug.
 */
export function buildSyntheticMemoryDraft(
  input: SyntheticObservationInput,
): SyntheticObservation {
  const toolName = input.toolName ?? input.hookType ?? "observation";
  const inputText = stringify(input.toolInput);
  const outputText = stringify(input.toolOutput);
  const prompt = input.userPrompt?.trim() ?? "";
  const narrative = truncate(
    [prompt, inputText, outputText].filter((part) => part.length > 0).join(" | "),
    400,
  );
  const files = extractFiles(input.toolInput);
  const type = inferMemoryType(toolName, input.hookType, narrative);
  const promotable = shouldPromote(type, narrative);

  return {
    type,
    title: truncate(toolName, 80),
    content: narrative.length > 0 ? narrative : toolName,
    files,
    concepts: files.map((file) => file.replace(/^.*\//, "")).slice(0, 6),
    importance: type === "bug" ? 7 : 5,
    promotable,
  };
}

export function inferMemoryType(
  toolName: string,
  hookType: string | undefined,
  narrative: string,
): MemoryFactType {
  const hook = (hookType ?? "").toLowerCase();
  const text = `${toolName} ${narrative}`.toLowerCase();
  if (
    hook.includes("fail") ||
    hook.includes("error") ||
    hook.includes("verif") ||
    /\b(error|exception|failed|failure)\b/.test(text)
  ) {
    return "bug";
  }
  if (/\b(always|never|prefer|preference|do not|don't)\b/.test(text)) {
    return "preference";
  }
  if (/\b(workflow|pipeline|process)\b/.test(text)) {
    return "workflow";
  }
  return "fact";
}

function shouldPromote(type: MemoryFactType, narrative: string): boolean {
  if (type === "bug" || type === "preference") {
    return true;
  }
  return /\b(always|never|prefer|do not|don't)\b/i.test(narrative);
}

function extractFiles(input: unknown): string[] {
  if (!input || typeof input !== "object") {
    return [];
  }
  const record = input as Record<string, unknown>;
  const files = new Set<string>();
  for (const key of [
    "file_path",
    "filepath",
    "path",
    "filePath",
    "file",
  ]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0 && value.length < 512) {
      files.add(value);
    }
  }
  return [...files];
}

function stringify(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
