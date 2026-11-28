import type { ModelToolCall } from "../../../modules/model-gateway";

const SUPPORTED_LEAKED_TOOL_TAGS = new Set([
  "read_file",
  "read_many_files",
  "search_files",
  "glob_files",
  "list_directory",
  "directory_tree",
  "goto_definition",
  "find_type_definition",
  "find_references",
  "hover_symbol",
  "document_symbol",
  "workspace_symbol",
  "find_implementation",
  "call_hierarchy",
  "analyze_change_impact",
]);

type AttributeValue =
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number };

function parseAttributeValue(raw: string): AttributeValue {
  const trimmed = raw.trim();

  if (trimmed === "true") {
    return { kind: "boolean", value: true };
  }
  if (trimmed === "false") {
    return { kind: "boolean", value: false };
  }

  // Integers are the primary case for tool args like startLine/endLine/maxMatches.
  if (/^-?\d+$/.test(trimmed)) {
    return { kind: "number", value: Number(trimmed) };
  }

  return { kind: "string", value: trimmed };
}

function unquote(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseAttributes(attrText: string): Record<string, unknown> {
  // Supports key="value", key='value', key=value.
  const attrs: Record<string, unknown> = {};
  const re =
    /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

  let match: RegExpExecArray | null = null;
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(attrText)) !== null) {
    const key = match[1];
    const rawValue = match[2] ?? match[3] ?? match[4] ?? "";
    const value = unquote(rawValue);
    const typed = parseAttributeValue(value);
    attrs[key] = typed.value;
  }

  return attrs;
}

/**
 * Recover tool calls from leaked tool-call markup present in assistant text.
 *
 * Supports:
 * - XML tags: `<list_directory path="." />`
 * - JSON objects: `{"tool":"list_directory","arguments":{"path":"."}}`
 *   (also `name` / `tool_name` / `toolName` and `args` / `parameters`)
 *
 * Conservative: only known discovery tools that are in the current grant.
 */
export function recoverLeakedToolCallsFromMarkup(params: {
  content: string;
  allowedToolNames: ReadonlySet<string>;
}): { toolCalls: ModelToolCall[]; warnings: string[] } {
  const { content, allowedToolNames } = params;
  const warnings: string[] = [];
  const toolCalls: ModelToolCall[] = [];
  let index = 0;

  index = recoverXmlTags(content, allowedToolNames, toolCalls, index);
  if (toolCalls.length === 0) {
    index = recoverJsonObjects(content, allowedToolNames, toolCalls, index);
  }

  if (
    toolCalls.length === 0 &&
    /<\s*(?:read_file|search_files|glob_files|list_directory|directory_tree|goto_definition|find_type_definition|find_references|hover_symbol|document_symbol|workspace_symbol|find_implementation|call_hierarchy|analyze_change_impact)\b/i.test(
      content,
    )
  ) {
    warnings.push(
      "Leaked tool-call markup was detected but no recoverable tool attributes were parsed.",
    );
  }

  if (
    toolCalls.length === 0 &&
    /["'](?:tool|name|tool_name|toolName)["']\s*:/.test(content)
  ) {
    warnings.push(
      "Leaked tool-call JSON was detected but no recoverable tool was parsed.",
    );
  }

  return { toolCalls, warnings };
}

function recoverXmlTags(
  content: string,
  allowedToolNames: ReadonlySet<string>,
  toolCalls: ModelToolCall[],
  startIndex: number,
): number {
  const tagRe = /<([A-Za-z_][A-Za-z0-9_-]*)\b([^>]*)>/g;
  let index = startIndex;
  let match: RegExpExecArray | null = null;
  // eslint-disable-next-line no-cond-assign
  while ((match = tagRe.exec(content)) !== null) {
    const tagName = match[1];
    const attrText = match[2] ?? "";

    if (!SUPPORTED_LEAKED_TOOL_TAGS.has(tagName)) {
      continue;
    }
    if (!allowedToolNames.has(tagName)) {
      continue;
    }

    const argumentsValue = parseAttributes(attrText);
    toolCalls.push({
      id: `recovered_${index}`,
      name: tagName,
      arguments: JSON.stringify(argumentsValue),
    });
    index += 1;
  }
  return index;
}

function recoverJsonObjects(
  content: string,
  allowedToolNames: ReadonlySet<string>,
  toolCalls: ModelToolCall[],
  startIndex: number,
): number {
  let index = startIndex;
  const trimmed = content.trim();

  // Whole-message JSON object or array.
  const candidates: unknown[] = [];
  tryParseJsonInto(trimmed, candidates);

  // Embedded JSON objects in prose — brace-balanced (nested arguments OK).
  for (const raw of extractBalancedJsonObjects(content)) {
    tryParseJsonInto(raw, candidates);
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const items = Array.isArray(candidate) ? candidate : [candidate];
    for (const item of items) {
      const recovered = coerceJsonToolCall(item, allowedToolNames, index);
      if (!recovered) continue;
      const key = `${recovered.name}:${recovered.arguments}`;
      if (seen.has(key)) continue;
      seen.add(key);
      toolCalls.push(recovered);
      index += 1;
    }
  }
  return index;
}

function tryParseJsonInto(raw: string, out: unknown[]): void {
  try {
    out.push(JSON.parse(raw) as unknown);
  } catch {
    /* ignore */
  }
}

/** Extract top-level `{...}` slices with nested braces preserved. */
function extractBalancedJsonObjects(content: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < content.length; j++) {
      const ch = content[j];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          out.push(content.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

function coerceJsonToolCall(
  value: unknown,
  allowedToolNames: ReadonlySet<string>,
  index: number,
): ModelToolCall | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const nameRaw =
    record.tool ?? record.name ?? record.tool_name ?? record.toolName;
  if (typeof nameRaw !== "string" || !nameRaw.trim()) return undefined;
  const name = nameRaw.trim();
  if (!SUPPORTED_LEAKED_TOOL_TAGS.has(name)) return undefined;
  if (!allowedToolNames.has(name)) return undefined;

  const argsRaw =
    record.arguments ?? record.args ?? record.parameters ?? record.input ?? {};
  let argsJson: string;
  if (typeof argsRaw === "string") {
    argsJson = argsRaw;
  } else {
    try {
      argsJson = JSON.stringify(argsRaw ?? {});
    } catch {
      argsJson = "{}";
    }
  }

  return {
    id: `recovered_json_${index}`,
    name,
    arguments: argsJson,
  };
}
