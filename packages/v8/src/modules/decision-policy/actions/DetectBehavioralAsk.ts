/**
 * Detects asks whose success depends on observable runtime behavior
 * (HTTP endpoints, runnable scripts, test suites) rather than on static
 * compile evidence alone. Compile-clean code can still leave a route
 * unwired, so these asks should prefer executed test/smoke evidence.
 */

export interface BehavioralAskSignals {
  /** HTTP endpoints / status codes / request tooling named by the ask. */
  http: boolean;
  /** Runnable package scripts / task runners named by the ask. */
  scripts: boolean;
  /** Test suites or test runners named by the ask. */
  tests: boolean;
}

const HTTP_PATTERNS: readonly RegExp[] = [
  /\bhttps?\s+(?:server|request|response|endpoint|route|status|api|handler)s?\b/i,
  /\b(?:rest|graphql|webhook)\b/i,
  /\bendpoints?\b/i,
  /\b(?:api|http)\s+routes?\b/i,
  /\broutes?\s+(?:handler|returns?|responds?|404|401|403|500)\b/i,
  /\bstatus\s+codes?\b/i,
  /\b(?:returns?|responds?\s+with|giving|gives|getting|gets)\s+(?:an?\s+)?(?:http\s+)?[1-5]\d{2}\b/i,
  /\b[1-5]\d{2}\s+(?:error|response|status|not\s+found)\b/i,
  /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[\w./:-]*/,
  /(?:^|[\s`'"(])\/api\/[\w./:-]+/i,
  /\b(?:curl|wget|supertest|httpie)\b/i,
  /\b(?:express|fastify|koa|hono|flask|fastapi|django)\s+(?:app|server|route|router|endpoint)s?\b/i,
];

const SCRIPT_PATTERNS: readonly RegExp[] = [
  /\b(?:npm|pnpm|yarn|bun)\s+run\s+[\w:-]+/i,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:test|start)\b/i,
  /\bpackage\.json\s+scripts?\b/i,
  /\bnpm\s+scripts?\b/i,
  /\b(?:make|just)\s+[\w-]+\s+(?:target|recipe)\b/i,
  /\bsmoke[\s-]?(?:test|check|script)s?\b/i,
];

const TEST_PATTERNS: readonly RegExp[] = [
  /\b(?:unit|integration|e2e|end-to-end|regression|smoke)\s+tests?\b/i,
  /\b(?:add|write|create|fix|update|make)\s+(?:the\s+|a\s+|some\s+|failing\s+)?tests?\b/i,
  /\b(?:run|rerun|re-run)\s+(?:the\s+|all\s+)?(?:tests?|test\s+suite|specs?)\b/i,
  /\btests?\s+(?:pass|passes|passing|fail|fails|failing)\b/i,
  /\b(?:pytest|vitest|jest|mocha|ctest|phpunit|rspec)\b/i,
  /\btest\s+suite\b/i,
];

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/** Docs-only asks that merely mention a route or script do not need behavior evidence. */
const DOCS_ONLY_ASK =
  /\b(?:document|readme|docs?|changelog|comment|rename)\b.{0,40}\b(?:only|just)\b|\b(?:only|just)\b.{0,24}\b(?:docs?|documentation|readme|comments?|typos?)\b/i;

export function detectBehavioralAskSignals(
  message: string,
): BehavioralAskSignals {
  const text = message.trim();
  if (text.length === 0 || DOCS_ONLY_ASK.test(text)) {
    return { http: false, scripts: false, tests: false };
  }
  return {
    http: matchesAny(text, HTTP_PATTERNS),
    scripts: matchesAny(text, SCRIPT_PATTERNS),
    tests: matchesAny(text, TEST_PATTERNS),
  };
}

/** True when the ask names HTTP behavior, runnable scripts, or tests. */
export function looksLikeBehavioralAsk(message: string): boolean {
  const signals = detectBehavioralAskSignals(message);
  return signals.http || signals.scripts || signals.tests;
}
