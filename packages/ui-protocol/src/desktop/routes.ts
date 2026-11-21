/**
 * Request/response schemas for key Desktop `/v1/*` JSON routes.
 * Streaming routes (`/v1/prompt`, `/v1/resume`, `/v1/ollama/pull`) live in
 * `protocol.ts`.
 */

import { z } from 'zod';

import { parseWire, type WireParseResult } from '../parse.js';

/** POST /v1/provider/test */
export const DesktopProviderTestRequestSchema = z.object({
  type: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
});
export type DesktopProviderTestRequest = z.infer<
  typeof DesktopProviderTestRequestSchema
>;

/** POST /v1/memory */
export const DesktopMemoryAddRequestSchema = z.object({ text: z.string() });
export type DesktopMemoryAddRequest = z.infer<
  typeof DesktopMemoryAddRequestSchema
>;

export const DesktopMemoryItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
});
export type DesktopMemoryItem = z.infer<typeof DesktopMemoryItemSchema>;

/** GET|POST|DELETE /v1/memory[...] */
export const DesktopMemoryListResponseSchema = z.object({
  memories: z.array(DesktopMemoryItemSchema),
});
export type DesktopMemoryListResponse = z.infer<
  typeof DesktopMemoryListResponseSchema
>;

export const DesktopCheckpointItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.string(),
  changedPaths: z.array(z.string()).optional(),
});
export type DesktopCheckpointItem = z.infer<typeof DesktopCheckpointItemSchema>;

/** GET|DELETE /v1/checkpoints[...] */
export const DesktopCheckpointListResponseSchema = z.object({
  checkpoints: z.array(DesktopCheckpointItemSchema),
});
export type DesktopCheckpointListResponse = z.infer<
  typeof DesktopCheckpointListResponseSchema
>;

/** POST /v1/ollama/pull */
export const DesktopOllamaPullRequestSchema = z.object({
  model: z.string().optional(),
  baseUrl: z.string().optional(),
});
export type DesktopOllamaPullRequest = z.infer<
  typeof DesktopOllamaPullRequestSchema
>;

/** `{ ok: false, error }` JSON failure used by memory / checkpoint routes. */
export const DesktopOkErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
});
export type DesktopOkError = z.infer<typeof DesktopOkErrorSchema>;

export function parseDesktopMemoryList(
  input: unknown,
): WireParseResult<DesktopMemoryListResponse> {
  return parseWire(DesktopMemoryListResponseSchema, input);
}

export function parseDesktopCheckpointList(
  input: unknown,
): WireParseResult<DesktopCheckpointListResponse> {
  return parseWire(DesktopCheckpointListResponseSchema, input);
}
