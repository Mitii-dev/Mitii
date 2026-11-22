import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildLiveCliArgs,
  gradeLiveRun,
  isLiveEvalEnabled,
  resolveLiveTimeoutSeconds,
  selectLivePrompts,
  snapshotsDiffer,
  snapshotWorkspace,
  type CuratedCatalogShape,
  type CuratedPrompt,
} from "./liveEval";

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(
  readFileSync(join(here, "curated-40.json"), "utf8"),
) as CuratedCatalogShape;

function prompt(overrides: Partial<CuratedPrompt["passBar"]> = {}): CuratedPrompt {
  return {
    id: 1,
    bucket: "api_security_path",
    prompt: "Build an Express endpoint",
    expectedRoute: "execute",
    passBar: {
      mutationRequired: true,
      acceptContinueWithoutMutation: false,
      ...overrides,
    },
  };
}

// --- Always-on: pure helpers, no model/API access -------------------------

describe("curated-40 live eval helpers", () => {
  it("is disabled unless MITII_LIVE_EVAL=1", () => {
    expect(isLiveEvalEnabled({})).toBe(false);
    expect(isLiveEvalEnabled({ MITII_LIVE_EVAL: "0" })).toBe(false);
    expect(isLiveEvalEnabled({ MITII_LIVE_EVAL: "true" })).toBe(false);
    expect(isLiveEvalEnabled({ MITII_LIVE_EVAL: "1" })).toBe(true);
  });

  it("selects by ids, bucket, and limit", () => {
    expect(selectLivePrompts(catalog, {})).toHaveLength(40);
    const first = catalog.prompts[0]!;
    expect(
      selectLivePrompts(catalog, { MITII_LIVE_EVAL_IDS: String(first.id) }).map(
        (p) => p.id,
      ),
    ).toEqual([first.id]);
    const bucketed = selectLivePrompts(catalog, {
      MITII_LIVE_EVAL_BUCKET: first.bucket,
    });
    expect(bucketed.length).toBeGreaterThan(0);
    expect(bucketed.every((p) => p.bucket === first.bucket)).toBe(true);
    expect(selectLivePrompts(catalog, { MITII_LIVE_EVAL_LIMIT: "3" })).toHaveLength(3);
  });

  it("resolves the per-prompt timeout with a safe default", () => {
    expect(resolveLiveTimeoutSeconds({})).toBe(300);
    expect(resolveLiveTimeoutSeconds({ MITII_LIVE_EVAL_TIMEOUT_SECONDS: "120" })).toBe(120);
    expect(resolveLiveTimeoutSeconds({ MITII_LIVE_EVAL_TIMEOUT_SECONDS: "-5" })).toBe(300);
  });

  it("builds an unattended CLI invocation with the wall-time pass-through", () => {
    expect(
      buildLiveCliArgs({ prompt: "do it", cwd: "/tmp/w", timeoutSeconds: 90 }),
    ).toEqual(["run", "--auto", "do it", "--cwd", "/tmp/w", "--timeout", "90"]);
  });

  it("never passes a mutation-required prompt on a continue-only or clean exit", () => {
    expect(gradeLiveRun(prompt(), { exitCode: 0, workspaceChanged: false }).pass).toBe(false);
    expect(gradeLiveRun(prompt(), { exitCode: 4, workspaceChanged: true }).pass).toBe(false);
    expect(gradeLiveRun(prompt(), { exitCode: null, workspaceChanged: true }).pass).toBe(false);
    expect(gradeLiveRun(prompt(), { exitCode: 0, workspaceChanged: true }).pass).toBe(true);
  });

  it("accepts answers and clarification when no mutation is required", () => {
    const ask = prompt({ mutationRequired: false });
    expect(gradeLiveRun(ask, { exitCode: 0, workspaceChanged: false }).pass).toBe(true);
    expect(gradeLiveRun(ask, { exitCode: 4, workspaceChanged: false }).pass).toBe(true);
    expect(gradeLiveRun(ask, { exitCode: 1, workspaceChanged: false }).pass).toBe(false);
  });

  it("detects workspace changes from content snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "mitii-snap-"));
    try {
      writeFileSync(join(dir, "a.txt"), "one");
      const before = snapshotWorkspace(dir);
      expect(snapshotsDiffer(before, snapshotWorkspace(dir))).toBe(false);
      writeFileSync(join(dir, "a.txt"), "two");
      expect(snapshotsDiffer(before, snapshotWorkspace(dir))).toBe(true);
      writeFileSync(join(dir, "b.txt"), "new");
      expect(snapshotsDiffer(before, snapshotWorkspace(dir))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- Opt-in live eval (MITII_LIVE_EVAL=1) ---------------------------------
// Requires a built CLI (`pnpm --filter @mitii/cli build`) and provider env
// (MITII_PROVIDER / API key). Never runs in default CI.

const liveEnabled = isLiveEvalEnabled(process.env);
const timeoutSeconds = resolveLiveTimeoutSeconds(process.env);
const cliEntry = resolve(
  process.env.MITII_LIVE_EVAL_CLI ?? join(here, "../../../../../../../apps/cli/bin/mitii.js"),
);

describe.skipIf(!liveEnabled)("curated-40 live eval", () => {
  it("has a built CLI entry", () => {
    expect(
      existsSync(cliEntry),
      `CLI entry not found at ${cliEntry}; build @mitii/cli or set MITII_LIVE_EVAL_CLI`,
    ).toBe(true);
  });

  for (const entry of selectLivePrompts(catalog, process.env)) {
    it(
      `#${entry.id} [${entry.bucket}] meets its pass bar`,
      () => {
        const workspace = mkdtempSync(join(tmpdir(), `mitii-live-${entry.id}-`));
        try {
          writeFileSync(
            join(workspace, "package.json"),
            JSON.stringify({ name: "eval-fixture", version: "0.0.0", private: true }),
          );
          const before = snapshotWorkspace(workspace);
          const run = spawnSync(
            process.execPath,
            [
              cliEntry,
              ...buildLiveCliArgs({
                prompt: entry.prompt,
                cwd: workspace,
                timeoutSeconds,
              }),
            ],
            {
              env: process.env,
              encoding: "utf8",
              timeout: (timeoutSeconds + 30) * 1000,
            },
          );
          const grade = gradeLiveRun(entry, {
            exitCode: run.status,
            workspaceChanged: snapshotsDiffer(before, snapshotWorkspace(workspace)),
          });
          expect(grade.pass, `${grade.reason}\n${run.stderr ?? ""}`.trim()).toBe(true);
        } finally {
          rmSync(workspace, { recursive: true, force: true });
        }
      },
      (timeoutSeconds + 60) * 1000,
    );
  }
});
