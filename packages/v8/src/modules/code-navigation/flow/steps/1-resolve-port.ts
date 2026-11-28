import type {
  CodeNavigationParsedInput,
  CodeNavigationPort,
  CodeNavigationResult,
} from "../../contracts";
import { portUnavailableResult } from "./4-build-result";

export type ResolvePortResult =
  | { ok: true; port: CodeNavigationPort }
  | { ok: false; result: CodeNavigationResult };

/**
 * Flow step 1: require an injected navigation port.
 */
export function resolveCodeNavigationPort(params: {
  port: CodeNavigationPort | undefined;
  operation: CodeNavigationParsedInput["operation"];
}): ResolvePortResult {
  if (!params.port) {
    return {
      ok: false,
      result: portUnavailableResult(params.operation),
    };
  }
  return { ok: true, port: params.port };
}
