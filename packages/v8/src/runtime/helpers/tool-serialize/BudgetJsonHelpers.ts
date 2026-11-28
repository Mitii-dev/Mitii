export function budgetObjectStrings(
  record: Record<string, unknown>,
  maxChars: number,
): { output: unknown; truncated: boolean } {
  let truncated = false;
  const stringKeys = Object.keys(record).filter(
    (key) => typeof record[key] === "string",
  );
  const perStringBudget = Math.max(
    1,
    Math.floor(maxChars / Math.max(1, stringKeys.length)),
  );
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      const clipped = clipString(value, perStringBudget);
      next[key] = clipped.text;
      truncated = truncated || clipped.truncated;
    } else if (Array.isArray(value)) {
      const budgeted = budgetArray(value, perStringBudget);
      next[key] = budgeted.output;
      truncated = truncated || budgeted.truncated;
    } else {
      next[key] = value;
    }
  }

  return { output: next, truncated };
}

export function budgetArray(
  value: unknown[],
  maxChars: number,
): { output: unknown[]; truncated: boolean } {
  let truncated = false;
  const perItemBudget = Math.max(1, Math.floor(maxChars / Math.max(1, value.length)));
  const output = value.map((item) => {
    if (typeof item === "string") {
      const clipped = clipString(item, perItemBudget);
      truncated = truncated || clipped.truncated;
      return clipped.text;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const budgeted = budgetObjectStrings(
        item as Record<string, unknown>,
        perItemBudget,
      );
      truncated = truncated || budgeted.truncated;
      return budgeted.output;
    }
    return item;
  });
  return { output, truncated };
}

export function clipString(
  value: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return {
    text: `${value.slice(0, Math.max(1, maxChars))}\n…[truncated]`,
    truncated: true,
  };
}
