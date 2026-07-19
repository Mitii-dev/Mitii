export type SkillInjectionStrategy = 'catalog' | 'summary' | 'full' | 'lazy-references';

export interface SkillManifest {
  id: string;
  version: string;
  apiVersion: string;
  edition: 'ce' | 'ee';
  name: string;
  description: string;
  owner: string;
  kind: 'workflow' | 'reference' | 'policy';
  modes: readonly string[];
  intents?: readonly string[];
  triggers?: readonly string[];
  negativeTriggers?: readonly string[];
  requiredTools?: readonly string[];
  optionalTools?: readonly string[];
  capabilities?: readonly string[];
  requires?: readonly string[];
  optional?: readonly string[];
  entrypoint: string;
  maxInjectionChars: number;
  injectionStrategy: SkillInjectionStrategy;
  trust: 'builtin' | 'installed' | 'workspace' | 'managed';
  priority: number;
}
