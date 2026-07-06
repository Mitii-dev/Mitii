export function isEmail(value: string): boolean {
  return /.+@.+\..+/.test(value);
}

export function assertRequired<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null) throw new Error(`Missing required field: ${field}`);
  return value;
}
