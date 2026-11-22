import { SETTINGS_KEY_PREFIX } from './contracts/catalogEntry.js';

export type PlainRecord = Record<string, unknown>;

export function isPlainRecord(value: unknown): value is PlainRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** `mitii.tokenBudget.outputRatio` → `['tokenBudget', 'outputRatio']`. */
export function settingPathSegments(key: string): string[] {
  const bare = key.startsWith(SETTINGS_KEY_PREFIX)
    ? key.slice(SETTINGS_KEY_PREFIX.length)
    : key;
  return bare.split('.').filter((segment) => segment.length > 0);
}

function cloneValue<T>(value: T): T {
  return value !== null && typeof value === 'object'
    ? (structuredClone(value) as T)
    : value;
}

/**
 * Nest flat `mitii.*` keys into an object tree. Values are cloned. Throws when
 * one key would be both a value and a group (e.g. `mitii.a` and `mitii.a.b`).
 */
export function nestFlatSettings(flat: Record<string, unknown>): PlainRecord {
  const root: PlainRecord = {};
  for (const [key, value] of Object.entries(flat)) {
    const segments = settingPathSegments(key);
    if (segments.length === 0) {
      throw new Error(`Invalid settings key: "${key}"`);
    }
    let cursor = root;
    for (const segment of segments.slice(0, -1)) {
      const next = cursor[segment];
      if (next === undefined) {
        const child: PlainRecord = {};
        cursor[segment] = child;
        cursor = child;
      } else if (isPlainRecord(next)) {
        cursor = next;
      } else {
        throw new Error(`Settings key "${key}" conflicts with a scalar parent`);
      }
    }
    const leaf = segments[segments.length - 1]!;
    if (cursor[leaf] !== undefined) {
      throw new Error(`Settings key "${key}" conflicts with an existing group or value`);
    }
    cursor[leaf] = cloneValue(value);
  }
  return root;
}

/** Read `mitii.a.b` or `a.b` from a nested tree; `undefined` when absent. */
export function getNestedSetting(tree: unknown, key: string): unknown {
  let cursor: unknown = tree;
  for (const segment of settingPathSegments(key)) {
    if (!isPlainRecord(cursor) || !(segment in cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

/** Immutable write of `mitii.a.b` or `a.b`; replaces non-object parents. */
export function setNestedSetting<T extends PlainRecord>(
  tree: T,
  key: string,
  value: unknown,
): T {
  const segments = settingPathSegments(key);
  if (segments.length === 0) {
    throw new Error(`Invalid settings key: "${key}"`);
  }
  const clone = structuredClone(tree) as PlainRecord;
  let cursor = clone;
  for (const segment of segments.slice(0, -1)) {
    if (!isPlainRecord(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment] as PlainRecord;
  }
  cursor[segments[segments.length - 1]!] = cloneValue(value);
  return clone as T;
}

/**
 * Flatten a nested tree back to `mitii.*` keys. `leafKeys` names the catalog
 * keys to read (so object-valued settings such as `mitii.mcp` stay whole);
 * keys absent from the tree are skipped.
 */
export function flattenNestedSettings(
  tree: unknown,
  leafKeys: Iterable<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of leafKeys) {
    const value = getNestedSetting(tree, key);
    if (value !== undefined) out[key] = cloneValue(value);
  }
  return out;
}
