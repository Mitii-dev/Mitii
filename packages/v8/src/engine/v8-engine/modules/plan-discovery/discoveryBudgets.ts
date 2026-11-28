/**
 * Shim — owner is `@mitii/v8` window-budget (`discoveryPassBudgets`).
 * Engine call sites keep this path until plan-discovery evacuates to runtime.
 */
export {
  DEFAULT_DISCOVERY_PASS_BUDGET,
  resolveDiscoveryPassBudget,
  scaleDiscoveryPassBudget,
  assertDiscoveryBudgetsMonotonic,
} from "../../../../modules/window-budget";
export type {
  DiscoveryPassBudget,
  DiscoveryTaskSize,
} from "../../../../modules/window-budget";
