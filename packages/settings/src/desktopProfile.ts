import { DEFAULT_MITII_SETTINGS, type MitiiSettings } from './defaults.js';
import { setNestedSetting, type PlainRecord } from './nest.js';

/**
 * Desktop-profile default overrides, keyed by flat `mitii.*` path (or a bare
 * path for Desktop-only fields that have no catalog entry; none today). Applied
 * over the catalog defaults; the catalog itself stays host-neutral.
 */
export const DESKTOP_DEFAULT_OVERRIDES: Readonly<Record<string, unknown>> = {
  'mitii.provider.type': 'openai-compatible',
  'mitii.provider.preset': 'ollama',
  'mitii.provider.baseUrl': 'http://127.0.0.1:11434/v1',
  // Desktop ships bundled MiniLM — keep vectors on unless source is disabled.
  'mitii.semanticIndex.enabled': true,
};

/** Desktop persists exactly the catalog settings tree (no Desktop-only fork). */
export type DesktopSettings = MitiiSettings;

function applyOverrides(
  base: MitiiSettings,
  overrides: Readonly<Record<string, unknown>>,
): DesktopSettings {
  let tree = base as unknown as PlainRecord;
  for (const [key, value] of Object.entries(overrides)) {
    tree = setNestedSetting(tree, key, value);
  }
  return tree as unknown as DesktopSettings;
}

/** Defaults Desktop starts from: catalog defaults + `DESKTOP_DEFAULT_OVERRIDES`. */
export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = applyOverrides(
  DEFAULT_MITII_SETTINGS,
  DESKTOP_DEFAULT_OVERRIDES,
);
