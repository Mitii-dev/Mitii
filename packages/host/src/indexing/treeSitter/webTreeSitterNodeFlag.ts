/** Reads a tree-sitter node flag that may be a boolean or a method. */
export function invokeNodeFlag(
  value: boolean | (() => boolean) | undefined,
): boolean {
  if (typeof value === 'function') {
    try {
      return Boolean(value());
    } catch {
      return false;
    }
  }
  return Boolean(value);
}
