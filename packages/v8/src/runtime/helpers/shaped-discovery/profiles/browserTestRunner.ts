import {
  createPathScorer,
  normalizeShapedQuery,
  type PathScoreRule,
} from "../factory";
import type { ShapedDiscoveryProfile } from "../types";

const STRONG_QUERY_PATTERNS: RegExp[] = [
  /\bheadless\b/i,
  /\bcapabilit(?:y|ies)\b/i,
  /\bchrome(?:options?|flags|args)?\b/i,
  /\bgoog:chromeoptions\b/i,
  /\b(?:chromium|firefox|safari|webkit)\b/i,
  /\bwebdriver\b/i,
  /\bwdio\b/i,
  /\bplaywright\b/i,
  /\bselenium\b/i,
  /\bcypress\b/i,
  /\bpuppeteer\b/i,
  /\bbrowserstack\b/i,
  /\bsaucelabs\b/i,
  /\btestcafe\b/i,
  /\bnightwatch\b/i,
  /\bdevice\s+emulation\b/i,
  /\bmobile\s+emulation\b/i,
  /\bviewport\b/i,
  /\buser[- ]agent\b/i,
  /\blaunch\s+(?:options?|args?|flags?)\b/i,
  /\bbrowser\s+context\b/i,
  /\btest\s+runner\b/i,
  /\btest\s+config(?:uration)?\b/i,
  /\be2e(?:\s+test(?:s|ing)?)?\b/i,
];

const WEAK_QUERY_PATTERNS: RegExp[] = [
  /\bbrowser(?:s)?\b/i,
  /\btest(?:s|ing|case(?:s)?|suite(?:s)?)?\b/i,
  /\b(?:spec|feature)\b/i,
  /\b(?:jest|vitest|karma|mocha|ava)\b/i,
];

const UNIT_TEST_RUNNER = /\b(?:jest|vitest|karma|mocha|ava)\b/i;

const EXPLICIT_CAPABILITY_CONTEXT =
  /\b(?:headless|capabilit|chrome|chromium|firefox|safari|webkit|webdriver|wdio|playwright|selenium|cypress|puppeteer|browserstack|saucelabs|viewport|user[- ]agent|launch|e2e)\b/i;

const hasExplicitCapabilityContext = (query: string): boolean =>
  EXPLICIT_CAPABILITY_CONTEXT.test(query);

export const matchesBrowserTestRunnerQuery = (query: string): boolean => {
  const q = normalizeShapedQuery(query);
  if (!q) return false;

  const hasBrowser = /\bbrowser(?:s)?\b/i.test(q);

  if (
    UNIT_TEST_RUNNER.test(q) &&
    !hasExplicitCapabilityContext(q) &&
    !hasBrowser &&
    !/\be2e\b/i.test(q)
  ) {
    return false;
  }

  if (STRONG_QUERY_PATTERNS.some((pattern) => pattern.test(q))) {
    return true;
  }

  const weakMatches = WEAK_QUERY_PATTERNS.filter((pattern) => pattern.test(q)).length;
  const hasTestContext =
    /\b(?:test|spec|feature|e2e|runner|suite|case)\b/i.test(q);

  return (
    weakMatches >= 2 ||
    (hasBrowser && (hasTestContext || hasExplicitCapabilityContext(q)))
  );
};

const PATH_SCORE_RULES: PathScoreRule[] = [
  { pattern: /(?:^|\/)testconfig(?:\.|[-_])/i, score: 100 },
  { pattern: /(?:^|\/)test-config(?:\.|[-_])/i, score: 100 },
  { pattern: /\/test\/shared\/config\//i, score: 80 },
  { pattern: /wdio\.[\w-]+\.conf\./i, score: 75 },
  { pattern: /(?:^|\/)wdio\.conf\./i, score: 40 },
  { pattern: /playwright\.config/i, score: 70 },
  { pattern: /cypress\.config/i, score: 70 },
  { pattern: /(?:^|\/)vitest\.config/i, score: 60 },
  { pattern: /(?:^|\/)jest\.config/i, score: 50 },
  { pattern: /(?:^|\/)karma\.conf/i, score: 60 },
  { pattern: /(?:^|\/)nightwatch\.conf/i, score: 60 },
  { pattern: /(?:^|\/)testcafe(?:\.[\w-]+)?\.(?:js|ts|json|cjs|mjs)$/i, score: 60 },
  {
    pattern:
      /(?:^|\/)(?:browser|capabilities|browserstack|saucelabs|device)[\w.-]*\.(?:ts|js|json)$/i,
    score: 70,
  },
  { pattern: /(?:^|\/)browser(?:s)?\.config/i, score: 65 },
  { pattern: /(?:^|\/)(?:e2e|integration|ui)[\w.-]*\.config/i, score: 50 },
];

const PATH_DEMOTION_RULES: PathScoreRule[] = [
  { pattern: /(?:^|\/)(?:docs?|documentation)\//i, score: -60 },
  {
    pattern: /(?:^|\/)(?:pages?|pageobjects?|fixtures?|mocks?|stubs?)\//i,
    score: -40,
  },
  { pattern: /\.(?:test|spec)\.(?:ts|js|jsx|tsx)$/i, score: -30 },
];

export const browserTestRunnerDiscoveryProfile: ShapedDiscoveryProfile = {
  id: "browser_test_runner",
  priority: 10,
  matchesQuery: matchesBrowserTestRunnerQuery,
  globPatterns: [
    "**/testConfig*.ts",
    "**/test-config*.ts",
    "**/wdio*.conf.ts",
    "**/playwright.config.*",
    "**/cypress.config.*",
    "**/vitest.config.*",
    "**/jest.config.*",
    "**/karma.conf.*",
    "**/nightwatch.conf.*",
    "**/.testcaferc.*",
  ],
  maxGlobPatterns: 3,
  searchQueries: [
    "headless",
    "capabilities",
    "chromeOptions",
    "goog:chromeOptions",
    "webdriver",
    "wdio config",
    "playwright config",
    "cypress config",
    "browserstack",
    "device emulation",
    "launch options",
    "e2e config",
  ],
  maxSearchQueries: 1,
  scorePath: createPathScorer(PATH_SCORE_RULES, PATH_DEMOTION_RULES),
  minSeedScore: 40,
  maxSeeds: 4,
  preferredPathsLabel:
    "Preferred capability/config paths (read these first — testConfig*.ts and named wdio*.conf.ts before generic wdio.conf.ts or README.md):",
  discoverySystemHint:
    "For browser/headless/test-runner asks, the capabilities source is usually testConfig*.ts or a named runner config — not README.md or page objects.",
};
