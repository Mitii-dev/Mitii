import { SETTINGS_CATALOG, SETTINGS_KEY_PREFIX } from '@mitii/settings';

/**
 * VS Code settings that are exposed as a field but live inside a parent
 * object key in the catalog (`mitii.mcp` is a single object setting).
 */
export const CATALOG_PARENT_OBJECT_KEYS: Readonly<Record<string, string>> = {
  'mcp.enabled': 'mitii.mcp',
};

/** `provider.type` → `mitii.provider.type`. */
export function toMitiiKey(setting: string): string {
  return `${SETTINGS_KEY_PREFIX}${setting}`;
}

/** Full catalog key that backs a VS Code field setting, honoring the parent-object allowlist. */
export function resolveCatalogKey(setting: string): string {
  return CATALOG_PARENT_OBJECT_KEYS[setting] ?? toMitiiKey(setting);
}

/** Keys (as `mitii.*`) that are not in the shared catalog. */
export function settingKeysMissingFromCatalog(
  settings: readonly string[],
): string[] {
  return settings
    .map((setting) => ({ setting, key: resolveCatalogKey(setting) }))
    .filter(({ key }) => !(key in SETTINGS_CATALOG))
    .map(({ key }) => key);
}

/** Throws when any setting is neither in the catalog nor allowlisted. */
export function assertSettingKeysInCatalog(settings: readonly string[]): void {
  const missing = settingKeysMissingFromCatalog(settings);
  if (missing.length > 0) {
    throw new Error(
      `Settings missing from @mitii/settings catalog: ${missing.join(', ')}`,
    );
  }
}
