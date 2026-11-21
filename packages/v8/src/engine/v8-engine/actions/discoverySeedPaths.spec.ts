import { describe, expect, it } from "vitest";

import {
  collectPreferredPlanningPaths,
  collectTrustedSeedPaths,
} from "./planningContext";
import {
  DISCOVERY_SEED_DROP_REASONS,
  isProsePathToken,
  resolveDiscoverySeedPaths,
} from "./discoverySeedPaths";

const KNOWN = [
  "src/auth/login.ts",
  "src/auth/session.ts",
  "packages/api/src/routes.ts",
  "packages/web/src/routes.ts",
  "docs/guide.md",
];

describe("isProsePathToken", () => {
  it.each(["node.js", "Next.js", "e.g.", "i.e", "v1.2.3", "3.5", "two words.ts"])(
    "treats %j as prose",
    (token) => {
      expect(isProsePathToken(token)).toBe(true);
    },
  );

  it.each(["src/index.js", "package.json", "login.ts", "README.md", "lib/next.js"])(
    "keeps %j as a path candidate",
    (token) => {
      expect(isProsePathToken(token)).toBe(false);
    },
  );
});

describe("resolveDiscoverySeedPaths", () => {
  it("drops prose tokens and urls", () => {
    const result = resolveDiscoverySeedPaths({
      paths: ["node.js", "https://example.com/a.html", "src/auth/login.ts", "e.g."],
      knownPaths: KNOWN,
    });
    expect(result.kept).toEqual(["src/auth/login.ts"]);
    expect(result.dropped.map((item) => item.reason)).toEqual([
      "prose_token",
      "prose_token",
      "prose_token",
    ]);
  });

  it("rewrites a bare basename to the indexed path", () => {
    const result = resolveDiscoverySeedPaths({
      paths: ["login.ts"],
      knownPaths: KNOWN,
    });
    expect(result.kept).toEqual(["src/auth/login.ts"]);
    expect(result.rewritten).toEqual([
      { from: "login.ts", to: ["src/auth/login.ts"] },
    ]);
  });

  it("caps ambiguous basename expansion", () => {
    const result = resolveDiscoverySeedPaths({
      paths: ["routes.ts"],
      knownPaths: KNOWN,
      maxExpansion: 1,
    });
    expect(result.kept).toEqual(["packages/api/src/routes.ts"]);
  });

  it("expands globs against the index and drops empty ones", () => {
    const result = resolveDiscoverySeedPaths({
      paths: ["src/auth/*.ts", "src/missing/**/*.ts"],
      knownPaths: KNOWN,
    });
    expect(result.kept).toEqual(["src/auth/login.ts", "src/auth/session.ts"]);
    expect(result.dropped).toEqual([
      { path: "src/missing/**/*.ts", reason: "unresolved_glob" },
    ]);
  });

  it("drops unresolved bare basenames only when an index exists and the user did not name them", () => {
    expect(
      resolveDiscoverySeedPaths({ paths: ["ghost.ts"], knownPaths: KNOWN }).dropped,
    ).toEqual([{ path: "ghost.ts", reason: "unresolved_basename" }]);
    expect(
      resolveDiscoverySeedPaths({ paths: ["ghost.ts"], knownPaths: [] }).kept,
    ).toEqual(["ghost.ts"]);
    expect(
      resolveDiscoverySeedPaths({
        paths: ["ghost.ts"],
        knownPaths: KNOWN,
        trustedPaths: ["ghost.ts"],
      }).kept,
    ).toEqual(["ghost.ts"]);
  });

  it("keeps full relative paths missing from the partial index (create asks)", () => {
    const result = resolveDiscoverySeedPaths({
      paths: ["src/server.ts"],
      knownPaths: KNOWN,
      trustedPaths: ["src/server.ts"],
    });
    expect(result.kept).toEqual(["src/server.ts"]);
    expect(result.dropped).toEqual([]);
  });

  it("drops unsafe paths and de-duplicates case-insensitively", () => {
    const result = resolveDiscoverySeedPaths({
      paths: ["../secrets.env", "/etc/passwd", "src/auth/login.ts", "SRC/auth/login.ts"],
      knownPaths: KNOWN,
    });
    expect(result.kept).toEqual(["src/auth/login.ts"]);
    expect(result.dropped.map((item) => item.reason)).toEqual([
      "unsafe_path",
      "unsafe_path",
    ]);
  });

  it("only emits declared drop reasons", () => {
    const result = resolveDiscoverySeedPaths({
      paths: ["node.js", "ghost.ts", "a/*.zz", "../x.ts"],
      knownPaths: KNOWN,
    });
    for (const item of result.dropped) {
      expect(DISCOVERY_SEED_DROP_REASONS).toContain(item.reason);
    }
  });
});

describe("preferred planning paths: prose hygiene", () => {
  it("does not turn prose in the query into seed paths", () => {
    const paths = collectPreferredPlanningPaths({
      query: "Port the server from Node.js to Next.js, i.e. update src/server.ts",
    });
    expect(paths).toContain("src/server.ts");
    expect(paths).not.toContain("Node.js");
    expect(paths).not.toContain("Next.js");
  });

  it("collects trusted seed paths without prose tokens", () => {
    const trusted = collectTrustedSeedPaths({
      seedPaths: ["src/a.ts"],
      evidenceTargets: [
        { kind: "file", value: "src/b.ts", explicit: true },
        { kind: "file", value: "src/c.ts", explicit: false },
        { kind: "file", value: "Node.js", explicit: true },
      ],
      query: "Update `src/d.ts` for Node.js",
    });
    expect(trusted).toEqual(
      expect.arrayContaining(["src/a.ts", "src/b.ts", "src/d.ts"]),
    );
    expect(trusted).not.toContain("src/c.ts");
    expect(trusted).not.toContain("Node.js");
  });
});
