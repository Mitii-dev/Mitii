/**
 * Shim — injects compactModelLoopMessages into runtime meta dispatch.
 */
import type { ModelMessage } from "../../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../../modules/prompt-construction";
import type { WindowPolicy } from "../../../../modules/window-budget";
import type { RequestMetaCommand } from "../../../../modules/request-intake";

import { compactModelLoopMessages } from "../../actions/compactModelLoopMessages";
import {
  handleMetaCommand as handleMetaCommandRuntime,
  type HandleMetaCommandInput as RuntimeHandleMetaCommandInput,
  type SessionControlResult,
} from "../../../../runtime/helpers/session-control";

export type HandleMetaCommandInput = Omit<
  RuntimeHandleMetaCommandInput,
  "compactMessages"
>;

export function handleMetaCommand(
  input: HandleMetaCommandInput,
): SessionControlResult {
  return handleMetaCommandRuntime({
    ...input,
    compactMessages: compactModelLoopMessages,
  });
}
