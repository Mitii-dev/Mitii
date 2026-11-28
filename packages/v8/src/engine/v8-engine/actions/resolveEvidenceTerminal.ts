/** Shim — owner is runtime/helpers/evidence-rail. */
export {
  shouldOfferContinueAfterEvidenceExhaustion,
  shouldStripDiscoveryAfterEvidenceExhaustion,
  isIllegalEvidencePhaseTransition,
  buildEvidenceExhaustedTerminalOutcome,
  bindBudgetConsumptionSnapshot,
} from "../../../runtime/helpers/evidence-rail";
export type {
  EvidenceRailPhase,
  EvidenceExhaustedFailedOutcome,
} from "../../../runtime/helpers/evidence-rail";
