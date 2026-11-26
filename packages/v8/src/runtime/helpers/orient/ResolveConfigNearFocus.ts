/**
 * Prefer config pointers under workRoot / focus parents (S1-CONFIG).
 */

export function resolveConfigNearFocus(input: {
  configPointers: readonly string[];
  focusPaths: readonly string[];
  workRoot?: string;
  limit?: number;
}): string[] {
  const limit = input.limit ?? 16;
  const pointers = [...new Set(input.configPointers.filter(Boolean))];
  if (pointers.length === 0) return [];

  const prefixes = new Set<string>();
  if (input.workRoot) prefixes.add(input.workRoot.replace(/\/+$/, ""));
  for (const focus of input.focusPaths) {
    const parts = focus.split("/").filter(Boolean);
    if (parts.length > 0) prefixes.add(parts[0]!);
    if (parts.length > 1) prefixes.add(parts.slice(0, -1).join("/"));
    if (input.workRoot) prefixes.add(input.workRoot);
  }

  const near: string[] = [];
  const rest: string[] = [];
  for (const pointer of pointers) {
    const hit = [...prefixes].some(
      (prefix) =>
        pointer === prefix ||
        pointer.startsWith(`${prefix}/`) ||
        (prefix !== "." && pointer.startsWith(prefix)),
    );
    if (hit) near.push(pointer);
    else rest.push(pointer);
  }

  return [...near, ...rest].slice(0, limit);
}
