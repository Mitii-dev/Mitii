import {
  GrantValidationError,
  validateToolAgainstGrant,
} from "../../../actions";
import type { ToolInvocationInput } from "../../../contracts";
import {
  StructuralShadowGrantAuthorizer,
  type ShadowGrantAuthorizer,
} from "../../../internal/shadow/ShadowGrantAuthorizer";
import type { RegisteredTool } from "../../../internal/ToolRegistry";
import { buildRejectedResult } from "../buildToolResult";
import type { CallClock, ToolExecuteOptions } from "../../types";
import { runShadowAuthorize } from "./runShadowAuthorize";
import type { PreflightFailure } from "./types";

const DEFAULT_SHADOW_AUTHORIZER = new StructuralShadowGrantAuthorizer();

export type GrantStageSuccess = {
  ok: true;
  shadow: ReturnType<ShadowGrantAuthorizer["authorize"]>;
};

export function validateGrantStage(params: {
  parsed: ToolInvocationInput;
  options: ToolExecuteOptions;
  registered: RegisteredTool;
  clock: CallClock;
}): GrantStageSuccess | PreflightFailure {
  const { parsed, options, registered, clock } = params;
  const authorizer = options.shadowAuthorizer ?? DEFAULT_SHADOW_AUTHORIZER;

  let primaryAllowed = true;
  try {
    validateToolAgainstGrant({
      tool: registered.definition,
      grant: parsed.grant,
    });
  } catch (error) {
    if (error instanceof GrantValidationError) {
      primaryAllowed = false;
      runShadowAuthorize({
        authorizer,
        tool: registered.definition,
        grant: parsed.grant,
        arguments: parsed.arguments,
        primaryAllowed,
        onShadowAuthorize: options.onShadowAuthorize,
      });
      return {
        ok: false,
        result: buildRejectedResult({
          parsed,
          clock,
          status: "rejected",
          reasonCode: error.reasonCode,
        }),
      };
    }
    throw error;
  }

  const shadow = runShadowAuthorize({
    authorizer,
    tool: registered.definition,
    grant: parsed.grant,
    arguments: parsed.arguments,
    primaryAllowed: true,
    onShadowAuthorize: options.onShadowAuthorize,
  });

  return { ok: true, shadow };
}
