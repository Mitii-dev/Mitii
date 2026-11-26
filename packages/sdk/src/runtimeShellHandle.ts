import type { AgentRunHandle, RuntimeRunResult } from '@mitii/v8';
import {
  createAgentRunHandleFromRuntimeResult as fromV8,
  mapRuntimeGateToSuspensionKind,
} from '@mitii/v8';

/**
 * SDK re-export of the V8 P8 bridge (SSOT in `@mitii/v8`).
 */
export function createAgentRunHandleFromRuntimeResult(
  runtime: RuntimeRunResult,
): AgentRunHandle {
  return fromV8(runtime);
}

/** @deprecated use mapRuntimeGateToSuspensionKind from `@mitii/v8`. */
export const mapSuspensionKind = mapRuntimeGateToSuspensionKind;
