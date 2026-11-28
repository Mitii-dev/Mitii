export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function safeText(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
    : normalized;
}

export function safeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => safeText(item))
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? items : undefined;
}

export function safeUrl(value: unknown): string | undefined {
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

export function formatLineRange(startLine: unknown, endLine: unknown): string | undefined {
  const start = typeof startLine === "number" ? startLine : undefined;
  const end = typeof endLine === "number" ? endLine : undefined;
  if (start && end) return `lines=${start}-${end}`;
  if (start) return `fromLine=${start}`;
  if (end) return `toLine=${end}`;
  return undefined;
}

export function formatPathList(label: string, paths: readonly string[] | undefined): string {
  if (!paths || paths.length === 0) return `${label}=none`;
  const preview = paths.slice(0, 5).join(",");
  const more = paths.length > 5 ? `,+${paths.length - 5}` : "";
  return `${label}=${preview}${more}`;
}

export function formatArgv(argv: readonly string[]): string {
  const preview = argv.slice(0, 8).join(" ");
  const more = argv.length > 8 ? ` …+${argv.length - 8}` : "";
  return `"${safeText(preview, 220) ?? ""}${more}"`;
}
