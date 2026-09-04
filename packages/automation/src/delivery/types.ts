import { z } from 'zod';

export const DELIVERY_ADAPTERS = [
  'slack',
  'discord',
  'telegram',
  'github_check',
  'github_comment',
  'webhook',
] as const;
export type DeliveryAdapter = (typeof DELIVERY_ADAPTERS)[number];

export const DELIVERY_STATUSES = [
  'pending',
  'sent',
  'failed',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const deliveryTargetSchema = z
  .object({
    adapter: z.enum(DELIVERY_ADAPTERS),
    /** Channel / chat / webhook URL / repo#pr depending on adapter. */
    target: z.string().min(1).max(2_000),
    /** Optional template overrides / metadata. */
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type DeliveryTarget = z.infer<typeof deliveryTargetSchema>;

export interface AutomationDeliveryRecord {
  deliveryId: string;
  runId: string;
  adapter: DeliveryAdapter;
  status: DeliveryStatus;
  targetJson: string;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Host/app injects concrete senders (connect adapters, gh, fetch).
 * @mitii/automation only queues + retries — no chat SDK imports.
 */
export interface DeliverySender {
  send(input: {
    adapter: DeliveryAdapter;
    target: DeliveryTarget;
    runId: string;
    title: string;
    status: string;
    reportPath?: string | null;
    answer?: string | null;
    error?: string | null;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
}
