export function collectToolText(output?: unknown, outputPreview?: string): string {
  const parts: string[] = [];
  if (typeof output === "string") {
    parts.push(output);
  } else if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    for (const key of ["stdout", "stderr", "output", "text", "content"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        parts.push(value);
      }
    }
  }
  if (outputPreview && outputPreview.trim().length > 0) {
    parts.push(outputPreview);
  }
  return parts.join("\n");
}

export function resolveFinding(output: unknown, outputPreview?: string): string | undefined {
  if (typeof output === "string" && output.trim().length > 0) {
    return output;
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (Array.isArray(record.diagnostics)) {
      return summarizeDiagnostics(record.diagnostics);
    }
    if (Array.isArray(record.matches)) {
      return summarizeMatches(record.matches);
    }
    if (Array.isArray(record.entries)) {
      return summarizeEntries(record.entries);
    }
    if (Array.isArray(record.files)) {
      return summarizeFiles(record.files);
    }
    if (typeof record.content === "string" && record.content.trim().length > 0) {
      return record.content;
    }
    if (typeof record.text === "string" && record.text.trim().length > 0) {
      return record.text;
    }
    if (typeof record.output === "string" && record.output.trim().length > 0) {
      return record.output;
    }
  }
  if (outputPreview && outputPreview.trim().length > 0) {
    return outputPreview;
  }
  return undefined;
}

export function summarizeDiagnostics(values: unknown[]): string | undefined {
  return values
    .slice(0, 6)
    .map((value) => {
      if (!value || typeof value !== "object") {
        return "";
      }
      const record = value as Record<string, unknown>;
      return [
        typeof record.path === "string" ? record.path : undefined,
        typeof record.startLine === "number" ? String(record.startLine) : undefined,
        typeof record.message === "string" ? record.message : undefined,
      ]
        .filter(Boolean)
        .join(":");
    })
    .filter(Boolean)
    .join("; ") || undefined;
}

export function summarizeMatches(values: unknown[]): string | undefined {
  return values
    .slice(0, 6)
    .map((value) => {
      if (!value || typeof value !== "object") {
        return "";
      }
      const record = value as Record<string, unknown>;
      return [
        typeof record.path === "string" ? record.path : undefined,
        typeof record.line === "number" ? String(record.line) : undefined,
        typeof record.text === "string" ? record.text : undefined,
      ]
        .filter(Boolean)
        .join(":");
    })
    .filter(Boolean)
    .join("; ") || undefined;
}

export function summarizeEntries(values: unknown[]): string | undefined {
  const names = values
    .slice(0, 12)
    .map((value) => {
      if (!value || typeof value !== "object") {
        return "";
      }
      const record = value as Record<string, unknown>;
      return typeof record.name === "string" ? record.name : "";
    })
    .filter(Boolean);
  return names.length > 0 ? `entries: ${names.join(", ")}` : undefined;
}

export function summarizeFiles(values: unknown[]): string | undefined {
  return values
    .slice(0, 4)
    .map((value) => {
      if (!value || typeof value !== "object") {
        return "";
      }
      const record = value as Record<string, unknown>;
      const path = typeof record.path === "string" ? record.path : undefined;
      const content =
        typeof record.content === "string"
          ? record.content.replace(/\s+/g, " ").trim().slice(0, 100)
          : undefined;
      return [path, content].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join("; ") || undefined;
}


