import { PROMPT_INJECTION_PATTERNS } from "../policy";
import type { DecisionReasonCode } from "../contracts";

export interface InjectionScanResult {
  detected: boolean;
  reasonCodes: DecisionReasonCode[];
  warnings: string[];
}

/**
 * Detects authority-broadening injection attempts in user text.
 * Detection never increases a grant; it only annotates the decision.
 */
export function scanPromptInjection(message: string): InjectionScanResult {
  const matched = PROMPT_INJECTION_PATTERNS.some((pattern) =>
    pattern.test(message),
  );

  if (!matched) {
    return { detected: false, reasonCodes: [], warnings: [] };
  }

  return {
    detected: true,
    reasonCodes: ["prompt_injection_ignored"],
    warnings: [
      "Authority-broadening instruction in the request was ignored; the tool grant was not expanded.",
    ],
  };
}
