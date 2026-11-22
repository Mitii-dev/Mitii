import { SETTINGS_CATALOG, type SettingsCatalogData } from './catalog.js';
import type { SettingsCatalog } from './contracts/catalogEntry.js';
import { nestFlatSettings } from './nest.js';

type DeepWiden<T> = T extends readonly (infer U)[]
  ? [U] extends [never]
    ? unknown[]
    : DeepWiden<U>[]
  : T extends object
    ? { -readonly [P in keyof T]: DeepWiden<T[P]> }
    : T;

type PathToTree<P extends string, V> = P extends `${infer Head}.${infer Rest}`
  ? { [K in Head]: PathToTree<Rest, V> }
  : { [K in P]: V };

type DefaultedKeys = {
  [K in keyof SettingsCatalogData]: SettingsCatalogData[K] extends { default: unknown }
    ? K
    : never;
}[keyof SettingsCatalogData] &
  string;

type TreeOfKey<K extends DefaultedKeys> = K extends `mitii.${infer Path}`
  ? SettingsCatalogData[K] extends { default: infer D }
    ? PathToTree<Path, DeepWiden<D>>
    : never
  : never;

type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

type Expand<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]: Expand<T[K]> }
    : T;

/** Nested settings object whose shape is derived from the catalog defaults. */
export type MitiiSettings = Expand<
  UnionToIntersection<{ [K in DefaultedKeys]: TreeOfKey<K> }[DefaultedKeys]>
>;

/** Nest every catalog default (`mitii.a.b` → `{ a: { b } }`). */
export function buildDefaultSettings(
  catalog: SettingsCatalog = SETTINGS_CATALOG,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(catalog)) {
    if (entry.default !== undefined) flat[key] = entry.default;
  }
  return nestFlatSettings(flat);
}

/** Catalog defaults as a nested object — never hand-edited. */
export const DEFAULT_MITII_SETTINGS = buildDefaultSettings() as MitiiSettings;
