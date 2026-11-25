import type { AgentMode } from "./types";
import { INTERACTION_MODE_DEFAULT } from "./constants";

/**
 * Resolve interaction mode: explicit host mode wins unless a leading
 * mode slash overrode it during command classify.
 *
 * `slashMode` is set only when `/ask|/plan|/agent` was consumed.
 * `hostMode` is the mode field on CreateUserRequestInput (required today).
 */
export function resolveInteractionMode(input: {
  hostMode: AgentMode;
  slashMode?: AgentMode;
}): AgentMode {
  if (input.slashMode) {
    return input.slashMode;
  }
  return input.hostMode ?? INTERACTION_MODE_DEFAULT;
}
