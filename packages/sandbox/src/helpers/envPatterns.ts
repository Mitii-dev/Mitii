/** Case-insensitive glob match for `*TOKEN*`, `*_KEY`, `AWS_*`, or exact. */
export function matchEnvPattern(name: string, pattern: string): boolean {
  const n = name.toUpperCase();
  const p = pattern.toUpperCase();
  if (p.startsWith('*') && p.endsWith('*') && p.length >= 2) {
    return n.includes(p.slice(1, -1));
  }
  if (p.startsWith('*')) {
    return n.endsWith(p.slice(1));
  }
  if (p.endsWith('*')) {
    return n.startsWith(p.slice(0, -1));
  }
  return n === p;
}

export function matchesAnyEnvPattern(
  name: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) => matchEnvPattern(name, pattern));
}
