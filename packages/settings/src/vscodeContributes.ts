import {
  SETTINGS_KEY_PREFIX,
  type SettingsCatalog,
  type SettingsCatalogEntry,
} from './contracts/catalogEntry.js';
import { SETTINGS_CATALOG } from './catalog.js';

/** Fields the catalog owns inside a VS Code `contributes.configuration` property. */
export const CATALOG_OWNED_FIELDS = [
  'type',
  'default',
  'description',
  'enum',
  'minimum',
  'maximum',
] as const;

export type VscodeContributesProperty = Partial<
  Pick<SettingsCatalogEntry, 'type' | 'description' | 'enum' | 'minimum' | 'maximum'>
> & { default?: unknown } & Record<string, unknown>;

/**
 * Project one catalog entry to its VS Code property shape. A `null` default
 * means "unset" and is omitted from the manifest.
 */
export function catalogEntryToContributesProperty(
  entry: SettingsCatalogEntry,
): VscodeContributesProperty {
  const out: VscodeContributesProperty = { type: entry.type };
  if (entry.default !== undefined && entry.default !== null) {
    out.default = structuredClone(entry.default);
  }
  out.description = entry.description;
  if (entry.enum) out.enum = [...entry.enum];
  if (entry.minimum !== undefined) out.minimum = entry.minimum;
  if (entry.maximum !== undefined) out.maximum = entry.maximum;
  return out;
}

/** Catalog → `contributes.configuration.properties` (catalog-owned fields only). */
export function catalogToContributesProperties(
  catalog: SettingsCatalog = SETTINGS_CATALOG,
): Record<string, VscodeContributesProperty> {
  const out: Record<string, VscodeContributesProperty> = {};
  for (const [key, entry] of Object.entries(catalog)) {
    out[key] = catalogEntryToContributesProperty(entry);
  }
  return out;
}

export type ContributesDrift =
  | { kind: 'missing'; key: string }
  | { kind: 'extra'; key: string }
  | { kind: 'changed'; key: string; fields: string[] };

function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/**
 * Compare `mitii.*` properties in a manifest against the catalog. Fields the
 * catalog does not own (scope, enumDescriptions, …) are ignored.
 */
export function diffContributesProperties(
  actual: Record<string, Record<string, unknown>>,
  catalog: SettingsCatalog = SETTINGS_CATALOG,
): ContributesDrift[] {
  const expected = catalogToContributesProperties(catalog);
  const drift: ContributesDrift[] = [];
  for (const [key, want] of Object.entries(expected)) {
    const have = actual[key];
    if (!have) {
      drift.push({ kind: 'missing', key });
      continue;
    }
    const fields = CATALOG_OWNED_FIELDS.filter(
      (field) => stable(want[field]) !== stable(have[field]),
    );
    if (fields.length > 0) drift.push({ kind: 'changed', key, fields: [...fields] });
  }
  for (const key of Object.keys(actual)) {
    if (key.startsWith(SETTINGS_KEY_PREFIX) && !(key in expected)) {
      drift.push({ kind: 'extra', key });
    }
  }
  return drift;
}
