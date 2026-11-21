/**
 * Mitii Desktop wire contract (v1).
 *
 * Schemas and inferred types are owned by `@mitii/ui-protocol`; this module
 * is a thin re-export so existing `shared/protocol` imports keep working.
 * Shared by engine HTTP, Electron preload, and renderer.
 */

export {
  DesktopAgentModeSchema,
  DesktopErrorEnvelopeSchema,
  DesktopHealthResponseSchema,
  DesktopHostModeSchema,
  DesktopMcpAppEventSchema,
  DesktopModelDeltaEventSchema,
  DesktopOllamaPullStreamLineSchema,
  DesktopPromptRequestSchema,
  DesktopPromptStreamLineSchema,
  DesktopResumeBodySchema,
  DesktopRunEventSchema,
  DesktopRunResultSchema,
  MITII_DESKTOP_PROTOCOL,
  MITII_DESKTOP_PROTOCOL_VERSION,
  createPromptId,
  isDesktopAgentMode,
  parseDesktopPromptBody,
  parseDesktopResumeBody,
  parseDesktopStreamLine,
} from '@mitii/ui-protocol';
export type {
  DesktopAgentMode,
  DesktopErrorEnvelope,
  DesktopHealthResponse,
  DesktopHostMode,
  DesktopMcpAppEvent,
  DesktopModelDeltaEvent,
  DesktopOllamaPullStreamLine,
  DesktopPromptRequest,
  DesktopPromptStreamLine,
  DesktopResumeBody,
  DesktopRunEvent,
  DesktopRunResult,
} from '@mitii/ui-protocol';
