import { scanPromptInjection } from "../../helpers";

export function scanDecisionInjection(rawMessage: string) {
  return scanPromptInjection(rawMessage);
}
