export function truncateForEvent(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}
