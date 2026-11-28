import type { AgentMode, MitiiResumeInput } from './contracts.js';
import {
  adaptEngineResumeToRuntime,
  type AdaptedEngineResume,
} from '@mitii/v8';

export type AdaptedRuntimeResume = AdaptedEngineResume & {
  mode?: AgentMode;
};

/**
 * Map SDK/engine resume envelope → runtime resume (delegates to V8 SSOT).
 */
export function adaptResumeToRuntime(params: {
  input: MitiiResumeInput;
  fallbackMessage: string;
  mode?: AgentMode;
}): AdaptedRuntimeResume {
  return adaptEngineResumeToRuntime({
    input: params.input,
    fallbackMessage: params.fallbackMessage,
    mode: params.mode,
  });
}
