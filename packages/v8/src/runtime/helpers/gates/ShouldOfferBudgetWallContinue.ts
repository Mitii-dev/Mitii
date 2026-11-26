/**
 * Whether a budget/stall wall should suspend for a user Continue/Stop choice.
 * Returns false only when continue overrides are exhausted.
 */
export function shouldOfferBudgetWallContinue(params: {
  continueOverrideCount?: number;
  maxContinueOverrides?: number;
}): boolean {
  const maxOverrides = params.maxContinueOverrides ?? 4;
  return (params.continueOverrideCount ?? 0) < maxOverrides;
}
