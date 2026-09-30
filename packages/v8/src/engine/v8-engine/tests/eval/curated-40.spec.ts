import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { V8_ENGINE_PROMOTION } from "../../promotion";

const here = dirname(fileURLToPath(import.meta.url));

type CuratedCatalog = {
  schemaVersion: number;
  count: number;
  prompts: Array<{
    id: number;
    bucket: string;
    prompt: string;
    expectedRoute: string;
    passBar: { acceptContinueWithoutMutation: boolean };
  }>;
  passBar: {
    forbidContinueOnlyPassWhenMutationRequired: boolean;
    noLivePaidApisInUnitCi: boolean;
  };
};

describe("curated-40 catalog", () => {
  const raw = readFileSync(join(here, "curated-40.json"), "utf8");
  const catalog = JSON.parse(raw) as CuratedCatalog;

  it("locks exactly 40 prompts across coverage buckets", () => {
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.count).toBe(40);
    expect(catalog.prompts).toHaveLength(40);
    const ids = catalog.prompts.map((p) => p.id);
    expect(new Set(ids).size).toBe(40);
    const buckets = new Set(catalog.prompts.map((p) => p.bucket));
    expect(buckets.has("api_security_path")).toBe(true);
    expect(buckets.has("nextjs_auth_webhooks")).toBe(true);
    expect(buckets.has("ts_compiler_bugfix")).toBe(true);
    expect(buckets.has("monorepo_build_verify")).toBe(true);
    expect(buckets.has("testing_mocks")).toBe(true);
    expect(buckets.has("security_fixes")).toBe(true);
  });

  it("forbids Continue-only pass when mutation is required", () => {
    expect(catalog.passBar.forbidContinueOnlyPassWhenMutationRequired).toBe(
      true,
    );
    expect(catalog.passBar.noLivePaidApisInUnitCi).toBe(true);
    for (const prompt of catalog.prompts) {
      expect(prompt.passBar.acceptContinueWithoutMutation).toBe(false);
      expect(prompt.prompt.length).toBeGreaterThan(10);
    }
  });

  it("is referenced by the promotion config", () => {
    expect(V8_ENGINE_PROMOTION.curatedCatalogPath).toContain("curated-40.json");
  });
});
