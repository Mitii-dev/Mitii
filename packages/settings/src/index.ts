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
  NUMBER_FIELD_TIERS,
  PROJECT_NUMBER_FIELDS_REASONS,
  ProjectNumberFieldsError,
  numberFieldDescriptorSchema,
  numberFieldPresentationMapSchema,
  numberFieldPresentationSchema,
  type NumberFieldDescriptor,
  type NumberFieldKind,
  type NumberFieldPresentation,
  type NumberFieldPresentationMap,
  type ProjectNumberFieldsReason,
} from './contracts/numberFieldDescriptor.js';
export {
  projectNumberFields,
  type ProjectNumberFieldsOptions,
} from './projectNumberFields.js';
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
export {
  LOOP_POLICY_PRESENTATION,
  TOKEN_BUDGET_PRESENTATION,
  V8_LOOP_POLICY_PRESENTATION,
} from './presentation/index.js';
