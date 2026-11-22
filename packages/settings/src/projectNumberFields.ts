import { SETTINGS_CATALOG, catalogEntriesForPrefix } from './catalog.js';
import type { SettingsCatalog } from './contracts/catalogEntry.js';
import {
  ProjectNumberFieldsError,
  numberFieldDescriptorSchema,
  numberFieldPresentationMapSchema,
  type NumberFieldDescriptor,
  type NumberFieldKind,
  type NumberFieldPresentationMap,
} from './contracts/numberFieldDescriptor.js';

export interface ProjectNumberFieldsOptions {
  /** Group used when the overlay gives none. Defaults to the prefix. */
  group?: string;
  /** Tier used when the overlay gives none. Defaults to `simple`. */
  tier?: (shortKey: string) => NumberFieldDescriptor['tier'];
  /**
   * Ship-baseline defaults keyed by short key. Wins over the catalog
   * `default`, so a host can show its runtime baseline while the catalog
   * keeps owning keys, bounds, and descriptions.
   */
  defaults?: Readonly<Record<string, number | undefined>>;
  catalog?: SettingsCatalog;
}

/** Short keys that are never numeric policy fields. */
const EXCLUDED_SHORT_KEYS: ReadonlySet<string> = new Set(['enabled']);

function isNumericType(type: unknown): boolean {
  const isNumeric = (t: unknown) => t === 'number' || t === 'integer';
  return Array.isArray(type) ? type.some(isNumeric) : isNumeric(type);
}

function isIntegerType(type: unknown): boolean {
  return type === 'integer' || (Array.isArray(type) && type.includes('integer'));
}

/**
 * Project the numeric entries under `prefix` into UI field descriptors.
 *
 * Keys, bounds, descriptions, and (unless `options.defaults` overrides) default
 * values come from the catalog. `presentation` supplies group/label/kind/step/
 * tier/docsHref/hiddenFromDebug; its key order sets the output order, and any
 * catalog fields it does not mention follow in catalog order.
 *
 * Throws `ProjectNumberFieldsError` when the overlay or defaults name a key
 * that is not a numeric catalog entry, or when a descriptor is invalid.
 */
export function projectNumberFields(
  prefix: string,
  presentation: NumberFieldPresentationMap = {},
  options: ProjectNumberFieldsOptions = {},
): NumberFieldDescriptor[] {
  const overlayParse = numberFieldPresentationMapSchema.safeParse(presentation);
  if (!overlayParse.success) {
    throw new ProjectNumberFieldsError(
      'invalid_overlay',
      [],
      overlayParse.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  const overlay = overlayParse.data;
  const catalog = options.catalog ?? SETTINGS_CATALOG;

  const numeric = catalogEntriesForPrefix(prefix, catalog).filter(
    ({ shortKey, entry }) =>
      !EXCLUDED_SHORT_KEYS.has(shortKey) && isNumericType(entry.type),
  );
  const byKey = new Map(numeric.map((item) => [item.shortKey, item]));

  const unknownOverlay = Object.keys(overlay).filter((key) => !byKey.has(key));
  if (unknownOverlay.length > 0) {
    throw new ProjectNumberFieldsError('unknown_overlay_key', unknownOverlay);
  }
  const unknownDefaults = Object.keys(options.defaults ?? {}).filter(
    (key) => !byKey.has(key),
  );
  if (unknownDefaults.length > 0) {
    throw new ProjectNumberFieldsError('unknown_default_key', unknownDefaults);
  }

  const ordered = [
    ...Object.keys(overlay).map((key) => byKey.get(key)!),
    ...numeric.filter(({ shortKey }) => !(shortKey in overlay)),
  ];

  return ordered.map(({ shortKey, entry }) => {
    const over = overlay[shortKey] ?? {};
    const max = entry.maximum;
    const inferred: NumberFieldKind = isIntegerType(entry.type)
      ? 'int'
      : typeof max === 'number' && max <= 1
        ? 'ratio'
        : 'number';
    const kind = over.kind ?? inferred;
    const baseline =
      options.defaults?.[shortKey] ??
      (typeof entry.default === 'number' ? entry.default : undefined);
    const tier = over.tier ?? options.tier?.(shortKey) ?? 'simple';

    const candidate = {
      key: shortKey,
      group: over.group ?? options.group ?? prefix,
      label: over.label ?? shortKey,
      description: entry.description,
      ...(over.docsHref !== undefined ? { docsHref: over.docsHref } : {}),
      kind,
      min: entry.minimum ?? 0,
      ...(typeof max === 'number' ? { max } : {}),
      step: over.step ?? (kind === 'ratio' ? 0.01 : 1),
      ...(baseline !== undefined ? { defaultValue: baseline } : {}),
      tier,
      ...(over.hiddenFromDebug !== undefined
        ? { hiddenFromDebug: over.hiddenFromDebug }
        : {}),
    };
    const parsed = numberFieldDescriptorSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ProjectNumberFieldsError(
        'invalid_descriptor',
        [shortKey],
        parsed.error.issues.map((i) => i.message).join('; '),
      );
    }
    return parsed.data;
  });
}
