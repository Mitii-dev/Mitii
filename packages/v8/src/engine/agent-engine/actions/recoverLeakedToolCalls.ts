import type { ModelToolCall } from "../../../modules/model-gateway";

const SUPPORTED_LEAKED_TOOL_TAGS = new Set([
  "read_file",
  "read_many_files",
  "search_files",
  "glob_files",
  "list_directory",
  "goto_definition",
  "find_references",
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
 * This is intentionally conservative:
 * - Only parses a small set of known read/discovery tags.
 * - Only produces tool calls for tools present in the current grant.
 * - Produces best-effort JSON args from attributes; no attempt is made
 *   to parse nested bodies.
 */
export function recoverLeakedToolCallsFromMarkup(params: {
  content: string;
  allowedToolNames: ReadonlySet<string>;
}): { toolCalls: ModelToolCall[]; warnings: string[] } {
  const { content, allowedToolNames } = params;
  const warnings: string[] = [];

  // Example expected input (may be leaked into text):
  //   <read_file path="src/util.ts" startLine="1" endLine="20">
  //   <search_files query="foo" path="src" maxMatches="10" caseSensitive="false" />
  //
  // We parse only the opening tag attributes.
  const tagRe = /<([A-Za-z_][A-Za-z0-9_-]*)\b([^>]*)>/g;

  const toolCalls: ModelToolCall[] = [];
  let index = 0;

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
    const argsJson = JSON.stringify(argumentsValue);

    toolCalls.push({
      id: `recovered_${index}`,
      name: tagName,
      arguments: argsJson,
    });
    index += 1;
  }

  if (
    toolCalls.length === 0 &&
    /<\s*(?:read_file|search_files|glob_files|list_directory|goto_definition|find_references|analyze_change_impact)\b/i.test(
      content,
    )
  ) {
    warnings.push(
      "Leaked tool-call markup was detected but no recoverable tool attributes were parsed.",
    );
  }

  return { toolCalls, warnings };
}
