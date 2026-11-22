import catalogJson from './data/catalog.json' with { type: 'json' };
import {
  SETTINGS_KEY_PREFIX,
  parseSettingsCatalog,
  type SettingsCatalog,
} from './contracts/catalogEntry.js';

/** Raw JSON shape, used only for compile-time default typing. */
export type SettingsCatalogData = typeof catalogJson;

/** Every `mitii.*` setting, validated at module load. */
export const SETTINGS_CATALOG: SettingsCatalog = parseSettingsCatalog(catalogJson);

export type CatalogKeyedEntry = {
  /** Full key, e.g. `mitii.autocomplete.enabled`. */
  key: string;
  /** Key relative to the requested prefix. */
  shortKey: string;
  entry: SettingsCatalog[string];
};

/**
 * Entries whose key equals or sits under `prefix` (with or without the
 * `mitii.` namespace).
 */
export function catalogEntriesForPrefix(
  prefix: string,
  catalog: SettingsCatalog = SETTINGS_CATALOG,
): CatalogKeyedEntry[] {
  const full = prefix.startsWith(SETTINGS_KEY_PREFIX)
    ? prefix
    : `${SETTINGS_KEY_PREFIX}${prefix}`;
  return Object.entries(catalog)
    .filter(([key]) => key === full || key.startsWith(`${full}.`))
    .map(([key, entry]) => ({
      key,
      shortKey: key.slice(full.length + 1) || key.slice(SETTINGS_KEY_PREFIX.length),
      entry,
    }));
}
