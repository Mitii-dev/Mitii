import { z } from 'zod';
import type { SkillManifest } from '../../../interfaces/skills/SkillManifest';
import { MAX_SKILL_DESCRIPTION_CHARS, MAX_SKILL_INJECTION_CHARS } from './skillLimits';

export const SUPPORTED_SKILL_API_VERSION = '1';

const stringList = z.array(z.string().trim().min(1)).max(256).default([]);

export const SkillPinRuleSchema = z.object({
  id: z.string().trim().min(1).max(120),
  scope: z.enum(['global', 'repository', 'project', 'mode', 'intent', 'task-kind', 'task-subtype', 'path']),
  value: z.string().trim().max(500).optional(),
  action: z.enum(['recommend', 'attach', 'exclude']),
  priority: z.number().int().min(-1000).max(1000).optional(),
}).strict();

export const SkillRoutingTestCaseSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  request: z.string().trim().min(1).max(20_000),
  mode: z.enum(['ask', 'plan', 'agent']).optional(),
  repositoryFacts: z.object({
    languages: stringList.optional(),
    frameworks: stringList.optional(),
    packageManagers: stringList.optional(),
    paths: stringList.optional(),
  }).strict().optional(),
  availableTools: stringList.optional(),
  availableCapabilities: stringList.optional(),
  expected: z.enum(['selected', 'suggested', 'rejected', 'not-selected']),
  maxInjectionChars: z.number().int().positive().max(MAX_SKILL_INJECTION_CHARS).optional(),
}).strict();

export const SkillManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/).max(120),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(MAX_SKILL_DESCRIPTION_CHARS),
  version: z.string().trim().min(1).max(64).default('1.0.0'),
  apiVersion: z.string().trim().min(1).max(32).default(SUPPORTED_SKILL_API_VERSION),
  owner: z.string().trim().min(1).max(160).default('workspace'),
  edition: z.enum(['ce', 'ee']).default('ce'),
  enabled: z.boolean().default(true),
  status: z.enum(['recommended', 'active', 'experimental', 'deprecated']).default('active'),
  kind: z.enum(['workflow', 'reference', 'policy']).default('workflow'),
  supportedModes: z.array(z.enum(['ask', 'plan', 'agent'])).min(1).max(3).default(['ask', 'plan', 'agent']),
  modes: stringList.optional(),
  intents: stringList.optional(),
  taskKinds: stringList.optional(),
  taskSubtypes: stringList.optional(),
  triggers: stringList.optional(),
  negativeTriggers: stringList.optional(),
  languages: stringList.optional(),
  frameworks: stringList.optional(),
  packageManagers: stringList.optional(),
  pathPatterns: stringList.optional(),
  requiredTools: stringList.optional(),
  optionalTools: stringList.optional(),
  requiredCapabilities: stringList.optional(),
  capabilities: stringList.optional(),
  dependencies: stringList.optional(),
  requires: stringList.optional(),
  conflicts: stringList.optional(),
  entrypoint: z.string().trim().min(1).max(300).default('SKILL.md'),
  referenceFiles: stringList.optional(),
  maxInjectionChars: z.number().int().min(200).max(MAX_SKILL_INJECTION_CHARS).default(8_000),
  injectionStrategy: z.enum(['catalog', 'summary', 'full', 'lazy-references']).default('lazy-references'),
  trust: z.enum(['builtin', 'installed', 'workspace', 'managed']).default('workspace'),
  priority: z.number().int().min(-1000).max(1000).default(0),
  tags: stringList.optional(),
  pinningRules: z.array(SkillPinRuleSchema).max(128).optional(),
  tests: z.array(SkillRoutingTestCaseSchema).max(256).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
}).strict();

export interface SkillValidationIssue {
  path: string;
  message: string;
  code: string;
}

export type SkillManifestInput = z.input<typeof SkillManifestSchema>;

export function validateSkillManifest(input: unknown): {
  success: boolean;
  manifest?: SkillManifest;
  issues: SkillValidationIssue[];
} {
  const result = SkillManifestSchema.safeParse(input);
  if (!result.success) {
    return {
      success: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    };
  }
  if (result.data.apiVersion !== SUPPORTED_SKILL_API_VERSION) {
    return {
      success: false,
      issues: [{
        path: 'apiVersion',
        message: `Unsupported skill API version ${result.data.apiVersion}; expected ${SUPPORTED_SKILL_API_VERSION}`,
        code: 'incompatible_api_version',
      }],
    };
  }
  return { success: true, manifest: result.data as SkillManifest, issues: [] };
}

export function legacySkillManifest(input: {
  id: string;
  name: string;
  description: string;
  trust?: SkillManifest['trust'];
}): SkillManifest {
  return SkillManifestSchema.parse({
    id: input.id,
    name: input.name,
    description: input.description,
    trust: input.trust ?? 'workspace',
  }) as SkillManifest;
}
