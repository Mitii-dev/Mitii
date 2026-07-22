export type SkillInjectionStrategy = 'catalog' | 'summary' | 'full' | 'lazy-references';
export type SkillMode = 'ask' | 'plan' | 'agent';
export type SkillEdition = 'ce' | 'ee';
export type SkillTrust = 'builtin' | 'installed' | 'workspace' | 'managed';
export type SkillPinScope =
  | 'global'
  | 'repository'
  | 'project'
  | 'mode'
  | 'intent'
  | 'task-kind'
  | 'task-subtype'
  | 'path';

export interface SkillPinRule {
  id: string;
  scope: SkillPinScope;
  value?: string;
  action: 'recommend' | 'attach' | 'exclude';
  priority?: number;
}

export interface SkillRoutingTestCase {
  id: string;
  name: string;
  request: string;
  mode?: SkillMode;
  repositoryFacts?: {
    languages?: readonly string[];
    frameworks?: readonly string[];
    packageManagers?: readonly string[];
    paths?: readonly string[];
  };
  availableTools?: readonly string[];
  availableCapabilities?: readonly string[];
  /** When true, pin this skill for the test (manual attachment). Default: organic selection only. */
  manualAttachment?: boolean;
  expected: 'selected' | 'suggested' | 'rejected' | 'not-selected';
  maxInjectionChars?: number;
}

export interface SkillManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  apiVersion: string;
  edition: SkillEdition;
  name: string;
  description: string;
  owner: string;
  kind: 'workflow' | 'reference' | 'policy';
  enabled: boolean;
  status: 'recommended' | 'active' | 'experimental' | 'deprecated';
  supportedModes: readonly SkillMode[];
  /** @deprecated Use supportedModes. Retained for contribution compatibility. */
  modes?: readonly string[];
  intents?: readonly string[];
  taskKinds?: readonly string[];
  taskSubtypes?: readonly string[];
  triggers?: readonly string[];
  negativeTriggers?: readonly string[];
  languages?: readonly string[];
  frameworks?: readonly string[];
  packageManagers?: readonly string[];
  pathPatterns?: readonly string[];
  requiredTools?: readonly string[];
  optionalTools?: readonly string[];
  requiredCapabilities?: readonly string[];
  /** @deprecated Use requiredCapabilities. */
  capabilities?: readonly string[];
  dependencies?: readonly string[];
  /** @deprecated Use dependencies. */
  requires?: readonly string[];
  conflicts?: readonly string[];
  entrypoint: string;
  referenceFiles?: readonly string[];
  maxInjectionChars: number;
  injectionStrategy: SkillInjectionStrategy;
  trust: SkillTrust;
  priority: number;
  tags?: readonly string[];
  pinningRules?: readonly SkillPinRule[];
  tests?: readonly SkillRoutingTestCase[];
  createdAt?: string;
  updatedAt?: string;
}
