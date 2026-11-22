import type { TokenBudgetPreview } from '@mitii/ui-core';
import { z } from 'zod';

import {
  AgentUiDepthSchema,
  AgentUiEffortSchema,
  AgentUiThoroughnessSchema,
  ContextTogglesSchema,
  LoopBandIdSchema,
} from './primitives.js';
import { ProviderSettingsSnapshotSchema } from './runtime-status.js';

export type { TokenBudgetPreview };

const NumberMapSchema = z.record(z.number());

export const TokenBudgetFieldDescriptorSchema = z.object({
  key: z.string(),
  group: z.string(),
  label: z.string(),
  description: z.string(),
  docsHref: z.string().optional(),
  kind: z.enum(['ratio', 'int', 'number']),
  min: z.number(),
  max: z.number().optional(),
  step: z.number(),
  defaultValue: z.number().optional(),
  /** High-level Developer controls vs core ratio/clamp fields. */
  tier: z.enum(['simple', 'advanced']).optional(),
  /** Hide fields owned by Modes → Run budget. */
  hiddenFromDebug: z.boolean().optional(),
});
export type TokenBudgetFieldDescriptor = z.infer<
  typeof TokenBudgetFieldDescriptorSchema
>;

/** Shape owned by `@mitii/ui-core`; validated structurally as an object. */
export const TokenBudgetPreviewSchema = z.custom<TokenBudgetPreview>(
  (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  { message: 'expected token budget preview object' },
);

export const TokenBudgetSettingsSnapshotSchema = z.object({
  enabled: z.boolean(),
  policy: NumberMapSchema,
  fields: z.array(TokenBudgetFieldDescriptorSchema),
  preview: TokenBudgetPreviewSchema,
});
export type TokenBudgetSettingsSnapshot = z.infer<
  typeof TokenBudgetSettingsSnapshotSchema
>;

export const LoopPolicyBandSnapshotSchema = z.object({
  id: LoopBandIdSchema,
  label: z.string(),
  rangeLabel: z.string(),
  contextWindowTokens: z.number(),
});
export type LoopPolicyBandSnapshot = z.infer<
  typeof LoopPolicyBandSnapshotSchema
>;

export const LoopPolicySettingsSnapshotSchema = z.object({
  enabled: z.boolean(),
  /** Effective thresholds (band + optional lab overrides). */
  thresholds: NumberMapSchema,
  /** Band-only shipped standards for the current context window. */
  bandThresholds: NumberMapSchema,
  band: LoopPolicyBandSnapshotSchema,
  fields: z.array(TokenBudgetFieldDescriptorSchema),
});
export type LoopPolicySettingsSnapshot = z.infer<
  typeof LoopPolicySettingsSnapshotSchema
>;

export const PolicyLabBandOptionSchema = z.object({
  id: LoopBandIdSchema,
  label: z.string(),
  rangeLabel: z.string(),
});
export type PolicyLabBandOption = z.infer<typeof PolicyLabBandOptionSchema>;

const BandNumberMapsSchema = z.object({
  compact: NumberMapSchema,
  standard: NumberMapSchema,
  wide: NumberMapSchema,
});

export const PolicyLabSettingsSnapshotSchema = z.object({
  /** Unused at runtime — kept for patch compatibility. Always false. */
  enabled: z.boolean(),
  /** Human path hint for ship sources. */
  filePath: z.string(),
  exists: z.boolean(),
  previewContextWindowTokens: z.number(),
  activeBand: LoopPolicyBandSnapshotSchema,
  editBand: LoopBandIdSchema,
  bands: z.array(PolicyLabBandOptionSchema),
  /** Full draft maps for all bands (Save writes these into V8 source). */
  loopByBand: BandNumberMapsSchema,
  windowByBand: BandNumberMapsSchema,
  /** Convenience aliases for the currently edited band. */
  loopOverrides: NumberMapSchema,
  windowOverrides: NumberMapSchema,
  loopThresholds: NumberMapSchema,
  loopBandThresholds: NumberMapSchema,
  windowPolicy: NumberMapSchema,
  windowBandPolicy: NumberMapSchema,
  loopFields: z.array(TokenBudgetFieldDescriptorSchema),
  windowFields: z.array(TokenBudgetFieldDescriptorSchema),
  loopBandHint: z.string(),
  shipPreviewNote: z.string(),
});
export type PolicyLabSettingsSnapshot = z.infer<
  typeof PolicyLabSettingsSnapshotSchema
>;

/** Opt-in VS Code UI features (Settings → Features). */
export const UiFeaturesSnapshotSchema = z.object({
  /** Show a Code Review button beside Review on the working-tree bar. */
  codeReviewButton: z.boolean(),
});
export type UiFeaturesSnapshot = z.infer<typeof UiFeaturesSnapshotSchema>;

export const ModeDefaultSettingsSnapshotSchema = z.object({
  /** Customer-facing Low / Medium / High for this mode. */
  thoroughness: AgentUiThoroughnessSchema,
  depth: AgentUiDepthSchema,
  approvalMode: z.string(),
  model: z.string().optional(),
});
export type ModeDefaultSettingsSnapshot = z.infer<
  typeof ModeDefaultSettingsSnapshotSchema
>;

export const RunBudgetSettingsSnapshotSchema = z.object({
  unlimited: z.boolean(),
  maxModelCalls: z.number(),
  maxToolCalls: z.number(),
  maxLoopIterations: z.number(),
  maxWallTimeMinutes: z.number(),
});
export type RunBudgetSettingsSnapshot = z.infer<
  typeof RunBudgetSettingsSnapshotSchema
>;

export const UiSettingsSnapshotSchema = z.object({
  showReasoning: z.boolean(),
  reasoningPreviewMaxChars: z.number(),
  depth: AgentUiDepthSchema,
  /** Working-set overlay: loop/mutation/repair caps. Default medium. */
  effort: AgentUiEffortSchema,
  modeDefaults: z.object({
    ask: ModeDefaultSettingsSnapshotSchema,
    plan: ModeDefaultSettingsSnapshotSchema,
    agent: ModeDefaultSettingsSnapshotSchema,
  }),
  contextToggles: ContextTogglesSchema,
  approvalMode: z.string(),
  runBudget: RunBudgetSettingsSnapshotSchema,
  /** Master gate for Settings → Developer options. */
  developerEnabled: z.boolean(),
  /** When true, depth + effort are edited separately under Developer → Intensity. */
  intensityOverrides: z.boolean(),
  /** Maps to mitii.debug (verbose Output channel / stacks). */
  debugLogging: z.boolean(),
  /** Maps to mitii.developer.modelIo (sanitized JSONL under .mitii/logs/). */
  modelIoLogging: z.boolean(),
  /** Opt-in IDE features (VS Code only). */
  features: UiFeaturesSnapshotSchema,
  /** Window-proportional token budget tunables (Debug → developer). */
  tokenBudget: TokenBudgetSettingsSnapshotSchema,
  /** Agent Engine loop/stall threshold tunables (Debug → developer). */
  loopPolicy: LoopPolicySettingsSnapshotSchema,
  /** V8-engine knobs (Debug → developer). Same wire shape as loopPolicy. */
  v8LoopPolicy: LoopPolicySettingsSnapshotSchema,
  /** Policy Admin — edits shipped V8 band tables (Save writes source). */
  policyLab: PolicyLabSettingsSnapshotSchema,
});
export type UiSettingsSnapshot = z.infer<typeof UiSettingsSnapshotSchema>;

const LoopPolicyPatchSchema = z.object({
  enabled: z.boolean().optional(),
  thresholds: NumberMapSchema.optional(),
  bandThresholds: NumberMapSchema.optional(),
  band: LoopPolicyBandSnapshotSchema.optional(),
});

export const UiSettingsPatchSchema = UiSettingsSnapshotSchema.omit({
  contextToggles: true,
  runBudget: true,
  modeDefaults: true,
  tokenBudget: true,
  loopPolicy: true,
  v8LoopPolicy: true,
  policyLab: true,
  features: true,
})
  .partial()
  .extend({
    contextToggles: ContextTogglesSchema.partial().optional(),
    runBudget: RunBudgetSettingsSnapshotSchema.partial().optional(),
    modeDefaults: z
      .object({
        ask: ModeDefaultSettingsSnapshotSchema.partial().optional(),
        plan: ModeDefaultSettingsSnapshotSchema.partial().optional(),
        agent: ModeDefaultSettingsSnapshotSchema.partial().optional(),
      })
      .optional(),
    features: UiFeaturesSnapshotSchema.partial().optional(),
    tokenBudget: z
      .object({
        enabled: z.boolean().optional(),
        policy: NumberMapSchema.optional(),
      })
      .optional(),
    loopPolicy: LoopPolicyPatchSchema.optional(),
    v8LoopPolicy: LoopPolicyPatchSchema.optional(),
    policyLab: PolicyLabSettingsSnapshotSchema.partial().optional(),
  });
export type UiSettingsPatch = z.infer<typeof UiSettingsPatchSchema>;

export const SettingsProfileViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: ProviderSettingsSnapshotSchema.pick({
    type: true,
    preset: true,
    baseUrl: true,
    model: true,
    contextWindow: true,
    maximumOutputTokens: true,
  }),
  hasSecret: z.boolean(),
  ui: UiSettingsSnapshotSchema.optional(),
  /** SHA-256 fingerprint only. Raw secrets stay out of settings and profiles. */
  secretHash: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type SettingsProfileView = z.infer<typeof SettingsProfileViewSchema>;
