export {
  SETTINGS_KEY_PREFIX,
  parseSettingsCatalog,
  settingsCatalogEntrySchema,
  settingsCatalogSchema,
  type SettingsCatalog,
  type SettingsCatalogEntry,
} from './contracts/catalogEntry.js';
export {
  SETTINGS_CATALOG,
  catalogEntriesForPrefix,
  type CatalogKeyedEntry,
} from './catalog.js';
export {
  DEFAULT_MITII_SETTINGS,
  buildDefaultSettings,
  type MitiiSettings,
} from './defaults.js';
export {
  DEFAULT_DESKTOP_SETTINGS,
  DESKTOP_DEFAULT_OVERRIDES,
  type DesktopSettings,
} from './desktopProfile.js';
export {
  flattenNestedSettings,
  getNestedSetting,
  isPlainRecord,
  nestFlatSettings,
  setNestedSetting,
  settingPathSegments,
  type PlainRecord,
} from './nest.js';
export {
  CATALOG_OWNED_FIELDS,
  catalogEntryToContributesProperty,
  catalogToContributesProperties,
  diffContributesProperties,
  type ContributesDrift,
  type VscodeContributesProperty,
} from './vscodeContributes.js';
