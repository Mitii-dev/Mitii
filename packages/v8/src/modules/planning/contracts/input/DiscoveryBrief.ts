import { z } from "zod";

import { PLANNING_SCHEMA_VERSION } from "../../constants";

export const DISCOVERY_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export const DISCOVERY_TARGET_KINDS = [
  "file",
  "folder",
  "symbol",
  "test",
  "config",
  "unknown",
] as const;
export const DISCOVERY_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export const DISCOVERY_VERIFICATION_KINDS = [
  "test",
  "typecheck",
  "lint",
  "manual",
  "unknown",
] as const;

export const DISCOVERY_OBSERVATION_LIMITS = {
  maxFilesRead: 40,
  maxSearchHits: 40,
  maxExplicitTargets: 32,
  maxConstraints: 20,
  maxVerificationHints: 16,
  maxNotes: 16,
} as const;

export const discoveryConfidenceSchema = z.enum(DISCOVERY_CONFIDENCE_LEVELS);
export const discoveryTargetKindSchema = z.enum(DISCOVERY_TARGET_KINDS);
export const discoveryRiskLevelSchema = z.enum(DISCOVERY_RISK_LEVELS);
export const discoveryVerificationKindSchema = z.enum(
  DISCOVERY_VERIFICATION_KINDS,
);

export const discoveryFileRefSchema = z
  .object({
    path: z.string().min(1).max(1_000),
    reason: z.string().min(1).max(500),
    symbols: z.array(z.string().min(1).max(200)).max(16).optional(),
  })
  .strict();

export const discoveryTargetSchema = z
  .object({
    kind: discoveryTargetKindSchema,
    value: z.string().min(1).max(1_000),
    reason: z.string().min(1).max(500),
    explicit: z.boolean(),
  })
  .strict();

export const discoveryChangeSurfaceSchema = z
  .object({
    path: z.string().min(1).max(1_000),
    actionHint: z.string().min(1).max(300),
    riskLevel: discoveryRiskLevelSchema,
    evidence: z.string().min(1).max(500),
  })
  .strict();

export const discoveryVerificationHintSchema = z
  .object({
    kind: discoveryVerificationKindSchema,
    command: z.string().min(1).max(300).optional(),
    reason: z.string().min(1).max(500),
  })
  .strict();

/**
 * Evidence collected before drafting a durable PlanArtifact.
 * Generic across domains — not an auth, bug, or feature-specific shape.
 * Does not carry mutable task status.
 */
export const discoveryBriefSchema = z
  .object({
    schemaVersion: z.literal(PLANNING_SCHEMA_VERSION),
    objective: z.string().min(1).max(1_000),
    filesRead: z.array(discoveryFileRefSchema).max(40),
    targets: z.array(discoveryTargetSchema).max(32),
    proposedChangeSurfaces: z.array(discoveryChangeSurfaceSchema).max(16),
    discoveredConstraints: z.array(z.string().min(1).max(500)).max(20),
    verificationHints: z.array(discoveryVerificationHintSchema).max(16),
    openQuestions: z.array(z.string().min(1).max(500)).max(12),
    confidence: discoveryConfidenceSchema,
  })
  .strict();

/**
 * Host-neutral observations the engine collected during read-only discovery.
 * Planning compiles these into a validated DiscoveryBrief.
 */
export const discoveryObservationSchema = z
  .object({
    schemaVersion: z.literal(PLANNING_SCHEMA_VERSION),
    objective: z.string().min(1).max(1_000),
    filesRead: z
      .array(discoveryFileRefSchema)
      .max(DISCOVERY_OBSERVATION_LIMITS.maxFilesRead)
      .default([]),
    searchHits: z
      .array(
        z
          .object({
            path: z.string().min(1).max(1_000),
            reason: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(DISCOVERY_OBSERVATION_LIMITS.maxSearchHits)
      .default([]),
    explicitTargets: z
      .array(discoveryTargetSchema)
      .max(DISCOVERY_OBSERVATION_LIMITS.maxExplicitTargets)
      .default([]),
    constraints: z
      .array(z.string().min(1).max(500))
      .max(DISCOVERY_OBSERVATION_LIMITS.maxConstraints)
      .default([]),
    verificationHints: z
      .array(discoveryVerificationHintSchema)
      .max(DISCOVERY_OBSERVATION_LIMITS.maxVerificationHints)
      .default([]),
    notes: z
      .array(z.string().min(1).max(500))
      .max(DISCOVERY_OBSERVATION_LIMITS.maxNotes)
      .default([]),
  })
  .strict();

export type DiscoveryConfidence = z.infer<typeof discoveryConfidenceSchema>;
export type DiscoveryTargetKind = z.infer<typeof discoveryTargetKindSchema>;
export type DiscoveryRiskLevel = z.infer<typeof discoveryRiskLevelSchema>;
export type DiscoveryVerificationKind = z.infer<
  typeof discoveryVerificationKindSchema
>;
export type DiscoveryFileRef = z.infer<typeof discoveryFileRefSchema>;
export type DiscoveryTarget = z.infer<typeof discoveryTargetSchema>;
export type DiscoveryChangeSurface = z.infer<
  typeof discoveryChangeSurfaceSchema
>;
export type DiscoveryVerificationHint = z.infer<
  typeof discoveryVerificationHintSchema
>;
export type DiscoveryBrief = z.infer<typeof discoveryBriefSchema>;
export type DiscoveryObservation = z.input<typeof discoveryObservationSchema>;
export type DiscoveryParsedObservation = z.infer<
  typeof discoveryObservationSchema
>;
