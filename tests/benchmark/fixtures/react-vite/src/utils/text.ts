/** Tiny helper used by retrieval / bugfix frontend cases. */
export function greet(name: string): string {
  // BUG: extra 'l' — bugfix cases ask the agent to return "Hello, {name}"
  return `Helllo, ${name}`;
}

export function maxLabelLength(labels: string[]): number {
  // BUG: off-by-one — should return the longest label length, not length-1
  if (labels.length === 0) return 0;
  return Math.max(...labels.map((label) => label.length)) - 1;
}
