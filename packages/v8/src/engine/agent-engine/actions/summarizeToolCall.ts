/**
 * Compact one-line tool-call summaries for host events.
 */
export function summarizeToolCall(
  toolName: string,
  argumentsValue: unknown,
): string | undefined {
  const args = asRecord(argumentsValue);
  if (!args) return undefined;

  const path = safeText(args.path);
  const paths = safeStringArray(args.paths);
  const query = safeText(args.query);
  const pattern = safeText(args.pattern);
  const url = safeUrl(args.url);
  const argv = safeStringArray(args.argv);
  const patches = Array.isArray(args.patches) ? args.patches : undefined;

  switch (toolName) {
    case "update_todos": {
      const type = safeText(args.type);
      const count = Array.isArray(args.items)
        ? args.items.length
        : Array.isArray(args.todos)
          ? args.todos.length
          : 0;
      return [type ? `type=${type}` : undefined, count ? `items=${count}` : undefined]
        .filter(Boolean)
        .join(" ");
    }
    case "list_directory":
      return `path=${path ?? "."}`;
    case "read_file": {
      const lineRange = formatLineRange(args.startLine, args.endLine);
      return [path ? `path=${path}` : undefined, lineRange]
        .filter(Boolean)
        .join(" ");
    }
    case "read_many_files":
      return formatPathList("paths", paths);
    case "search_files":
      return [
        query ? `query="${query}"` : undefined,
        path ? `path=${path}` : undefined,
        typeof args.maxMatches === "number" ? `maxMatches=${args.maxMatches}` : undefined,
        typeof args.caseSensitive === "boolean"
          ? `caseSensitive=${args.caseSensitive}`
          : undefined,
      ]
        .filter(Boolean)
        .join(" ");
    case "glob_files":
      return [
        pattern ? `pattern=${pattern}` : undefined,
        path ? `path=${path}` : undefined,
        typeof args.maxResults === "number" ? `maxResults=${args.maxResults}` : undefined,
      ]
        .filter(Boolean)
        .join(" ");
    case "file_metadata":
    case "read_package_scripts":
      return [
        path ? `path=${path}` : undefined,
        typeof args.includeHash === "boolean"
          ? `includeHash=${args.includeHash}`
          : undefined,
      ]
        .filter(Boolean)
        .join(" ");
    case "goto_definition":
    case "find_references":
    case "hover_symbol":
      return [
        path ? `path=${path}` : undefined,
        typeof args.line === "number" ? `line=${args.line}` : undefined,
        typeof args.column === "number" ? `column=${args.column}` : undefined,
        typeof args.symbolName === "string" ? `symbol=${args.symbolName}` : undefined,
      ]
        .filter(Boolean)
        .join(" ");
    case "read_diagnostics":
    case "read_git_status":
      return [
        paths ? formatPathList("paths", paths) : "paths=all",
        typeof args.includeDiff === "boolean"
          ? `includeDiff=${args.includeDiff}`
          : undefined,
      ]
        .filter(Boolean)
        .join(" ");
    case "apply_patch": {
      const patchPaths = patches
        ?.map((patch) => safeText(asRecord(patch)?.path))
        .filter((value): value is string => Boolean(value));
      return [
        `patches=${patches?.length ?? 0}`,
        patchPaths?.length ? formatPathList("paths", patchPaths) : undefined,
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "delete_file":
    case "delete_directory":
      return [
        path ? `path=${path}` : undefined,
        typeof args.recursive === "boolean" ? `recursive=${args.recursive}` : undefined,
      ]
        .filter(Boolean)
        .join(" ");
    case "move_file": {
      const from = safeText(args.from);
      const to = safeText(args.to);
      return [from ? `from=${from}` : undefined, to ? `to=${to}` : undefined]
        .filter(Boolean)
        .join(" ");
    }
    case "run_command":
    case "run_readonly_command":
      return argv ? `argv=${formatArgv(argv)}` : undefined;
    case "fetch_url":
    case "fetch_docs":
      return url ? `url=${url}` : undefined;
    case "web_search":
      return query ? `query="${query}"` : undefined;
    case "sequential_thinking": {
      const n =
        typeof args.thoughtNumber === "number" ||
        typeof args.thoughtNumber === "string"
          ? String(args.thoughtNumber)
          : undefined;
      const total =
        typeof args.totalThoughts === "number" ||
        typeof args.totalThoughts === "string"
          ? String(args.totalThoughts)
          : undefined;
      return n && total ? `thought=${n}/${total}` : undefined;
    }
    case "get_current_time":
      return typeof args.timezone === "string"
        ? `timezone=${args.timezone}`
        : undefined;
    case "convert_time":
      return [
        typeof args.sourceTimezone === "string"
          ? `from=${args.sourceTimezone}`
          : undefined,
        typeof args.targetTimezone === "string"
          ? `to=${args.targetTimezone}`
          : undefined,
        typeof args.time === "string" ? `time=${args.time}` : undefined,
      ]
        .filter(Boolean)
        .join(" ");
    case "read_git_log":
      return typeof args.maxCount === "number"
        ? `maxCount=${args.maxCount}`
        : undefined;
    case "read_git_show":
      return typeof args.revision === "string"
        ? `revision=${args.revision}`
        : undefined;
    case "memory_graph_search":
      return typeof args.query === "string" ? `query="${args.query}"` : undefined;
    case "memory_graph_update":
      return typeof args.operation === "string"
        ? `op=${args.operation}`
        : undefined;
    case "directory_tree":
      return typeof args.path === "string" ? `path=${args.path}` : undefined;
    case "emit_review_finding": {
      // Compact, host-parseable line for editor diagnostics/comments.
      const file = path ?? safeText(args.file);
      const line =
        typeof args.startLine === "number"
          ? args.startLine
          : typeof args.line === "number"
            ? args.line
            : undefined;
      const sev = safeText(args.severity, 24) ?? "medium";
      const cat = safeText(args.category, 40);
      const msg =
        safeText(args.content, 220) ??
        safeText(args.title, 120) ??
        safeText(args.description, 180);
      return [
        "finding",
        file ? `path=${file}` : undefined,
        line ? `line=${line}` : undefined,
        `sev=${sev}`,
        cat ? `cat=${cat}` : undefined,
        msg ? `:: ${msg}` : undefined,
      ]
        .filter(Boolean)
        .join(" ");
    }
    default: {
      const keys = Object.keys(args)
        .filter((key) => !key.startsWith("_"))
        .slice(0, 8);
      return keys.length > 0 ? `args=${keys.join(",")}` : undefined;
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeText(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
    : normalized;
}

function safeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => safeText(item))
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? items : undefined;
}

function safeUrl(value: unknown): string | undefined {
  const raw = safeText(value, 240);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    return safeText(url.toString(), 240);
  } catch {
    return raw.split("?")[0]?.split("#")[0];
  }
}

function formatLineRange(startLine: unknown, endLine: unknown): string | undefined {
  const start = typeof startLine === "number" ? startLine : undefined;
  const end = typeof endLine === "number" ? endLine : undefined;
  if (start && end) return `lines=${start}-${end}`;
  if (start) return `fromLine=${start}`;
  if (end) return `toLine=${end}`;
  return undefined;
}

function formatPathList(label: string, paths: readonly string[] | undefined): string {
  if (!paths || paths.length === 0) return `${label}=none`;
  const preview = paths.slice(0, 5).join(",");
  const more = paths.length > 5 ? `,+${paths.length - 5}` : "";
  return `${label}=${preview}${more}`;
}

function formatArgv(argv: readonly string[]): string {
  const preview = argv.slice(0, 8).join(" ");
  const more = argv.length > 8 ? ` …+${argv.length - 8}` : "";
  return `"${safeText(preview, 220) ?? ""}${more}"`;
}
