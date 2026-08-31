import { z } from 'zod';

import type { AutomationRunRecord, AutomationSpecRecord } from '../types.js';

export const automationEventEnvelopeSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    eventType: z.string().min(1).max(200),
    source: z.string().min(1).max(120),
    subject: z.string().min(1).max(500).optional(),
    occurredAt: z.string().min(1).optional(),
    workspaceRoot: z.string().min(1).optional(),
    dedupeKey: z.string().min(1).max(500).optional(),
    payload: z.record(z.unknown()).optional(),
    attributes: z.record(z.unknown()).optional(),
  })
  .strict();

export type AutomationEventEnvelope = z.infer<
  typeof automationEventEnvelopeSchema
>;

export type EventProcessingStatus =
  | 'received'
  | 'unmatched'
  | 'queued'
  | 'suppressed'
  | 'failed';

export interface AutomationEventLogRecord {
  eventId: string;
  eventType: string;
  source: string;
  subject: string | null;
  occurredAt: string;
  receivedAt: string;
  workspaceRoot: string | null;
  dedupeKey: string | null;
  payloadJson: string | null;
  attributesJson: string | null;
  processingStatus: EventProcessingStatus;
  matchedSpecCount: number;
  queuedRunCount: number;
  suppressedCount: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EventSuppressionReason =
  | 'duplicate_event'
  | 'filter_mismatch'
  | 'dedupe_window'
  | 'cooldown'
  | 'max_parallel';

export interface EventSuppression {
  specId?: string;
  externalId?: string;
  reason: EventSuppressionReason;
  dedupeKey?: string;
}

export interface EventIngressResult {
  event: AutomationEventLogRecord;
  duplicate: boolean;
  matchedSpecs: AutomationSpecRecord[];
  queuedRuns: AutomationRunRecord[];
  suppressions: EventSuppression[];
}
