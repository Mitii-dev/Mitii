/**
 * Stage 1 — Normalize & Guard (S2C-FLOW).
 * Absorbs: injection scan (+ mode/turn seals applied later in route/grant).
 */

import { scanDecisionInjection } from "./1-scan-injection";

export function normalizeAndGuard(rawMessage: string) {
  return scanDecisionInjection(rawMessage);
}
