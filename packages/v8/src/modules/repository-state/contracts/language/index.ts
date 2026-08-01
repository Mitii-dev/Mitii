export {
  LANGUAGE_IDS,
  languageIdSchema,
  languageCapabilityLevelSchema,
  languageProfileSchema,
  languageDetectionEvidenceSchema,
  projectDescriptorSchema,
} from "./LanguageContracts";
export type {
  LanguageId,
  LanguageCapabilityLevel,
  LanguageProfile,
  LanguageDetectionEvidence,
  ProjectDescriptor,
} from "./LanguageContracts";

export {
  LanguageProfileRegistry,
  defaultLanguageProfileRegistry,
} from "./LanguageProfileRegistry";
