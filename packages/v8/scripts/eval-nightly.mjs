#!/usr/bin/env node
/**
 * Nightly / manual broader eval slice for v8-engine.
 *
 * Unit CI already runs always-on stub goldens. This script:
 * 1. Validates curated-40.json
 * 2. Re-runs the v8-engine vitest suite (always-on + unit)
 * 3. Prints catalog bucket coverage for live/recorded drivers to consume
 *
 * 4. Optional: with MITII_LIVE_EVAL=1 also runs the live curated-40 eval
 *    (tests/eval/curated-40.live.spec.ts) against a built CLI.
 *
 * Default (flag unset) never calls live paid APIs.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const catalogPath = join(
  packageRoot,
  "src/engine/v8-engine/tests/eval/curated-40.json",
);

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

if (catalog.count !== 40 || catalog.prompts.length !== 40) {
  console.error(
    `curated-40.json expected 40 prompts, got count=${catalog.count} len=${catalog.prompts.length}`,
  );
  process.exit(1);
}

const buckets = new Map();
for (const prompt of catalog.prompts) {
  buckets.set(prompt.bucket, (buckets.get(prompt.bucket) ?? 0) + 1);
}

console.log("v8-engine nightly eval");
console.log(`  curated-40: ${catalog.count} prompts`);
for (const [bucket, n] of [...buckets.entries()].sort()) {
  console.log(`    ${bucket}: ${n}`);
}

const result = spawnSync(
  "npx",
  ["vitest", "run", "src/engine/v8-engine", "--reporter=dot"],
  {
    cwd: packageRoot,
    stdio: "inherit",
    env: process.env,
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("always-on goldens + unit: ok");
if (process.env.MITII_LIVE_EVAL !== "1") {
  console.log(
    "live curated-40: skipped (catalog validation only). Set MITII_LIVE_EVAL=1 to run it.",
  );
  process.exit(0);
}

console.log("live curated-40: running (MITII_LIVE_EVAL=1)");
const live = spawnSync(
  "npx",
  [
    "vitest",
    "run",
    "src/engine/v8-engine/tests/eval/curated-40.live.spec.ts",
    "--reporter=verbose",
  ],
  { cwd: packageRoot, stdio: "inherit", env: process.env },
);
process.exit(live.status ?? 1);
