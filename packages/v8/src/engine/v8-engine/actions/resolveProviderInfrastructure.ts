/**
 * Phase 5: classify model-gateway transport failures as infrastructure,
 * not agent logic failure. Bounded retry already lives in the gateway;
 * after exhaustion the engine should suspend Continuable state (or report
 * infrastructure) instead of a bare "agent failed".
 */

const INFRASTRUCTURE_ERROR_CODES = new Set([
  "provider_unavailable",
  "rate_limited",
]);

const INFRASTRUCTURE_MESSAGE =
  /\b(?:fetch failed|network|econnreset|econnrefused|etimedout|socket|dns|unavailable|unreachable)\b/i;

export function isProviderInfrastructureFailure(params: {
  errorCode?: string;
  errorMessage?: string;
}): boolean {
  const code = params.errorCode?.trim();
  if (code && INFRASTRUCTURE_ERROR_CODES.has(code)) {
    return true;
  }
  if (code === "provider_failed" || code === "execution_failed") {
    return INFRASTRUCTURE_MESSAGE.test(params.errorMessage ?? "");
  }
  return INFRASTRUCTURE_MESSAGE.test(params.errorMessage ?? "");
}

export function providerInfrastructureUserMessage(params: {
  errorMessage?: string;
}): string {
  const detail = params.errorMessage?.trim();
  return [
    "Model provider is unreachable (infrastructure).",
    detail && detail.toLowerCase() !== "fetch failed"
      ? `Detail: ${detail}`
      : "The network request to the model provider failed after bounded retries.",
    "Your run state is preserved — Continue to retry when the provider is back, or Stop.",
  ]
    .filter(Boolean)
    .join(" ");
}
