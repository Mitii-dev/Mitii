import type { StepContext } from "./StepContext";
import type { SituationPack } from "../../contracts/orient/SituationPack";
import type { RuntimeDecisionSketch } from "./5-Decide";

export interface ContextBundleSketch {
  schemaVersion: 1;
  summary: string;
  focusPaths: string[];
  route: string;
  grantProfile: string;
  reasonCodes: string[];
}

/**
 * Step 9 — Enrich → ContextBundle sketch (full repo/skills/memory later).
 */
export function enrichContext(ctx: StepContext): ContextBundleSketch {
  const pack = ctx.store.getSlice<SituationPack>("situationPack");
  const decision = ctx.store.getSlice<RuntimeDecisionSketch>("decision");
  const focusPaths = pack?.scope.focusPaths ?? [];
  const bundle: ContextBundleSketch = {
    schemaVersion: 1,
    summary: [
      `route=${decision?.route ?? "unknown"}`,
      `grant=${decision?.grantProfile ?? "unknown"}`,
      focusPaths.length > 0
        ? `focus=${focusPaths.slice(0, 6).join(",")}`
        : "focus=none",
    ].join("; "),
    focusPaths,
    route: decision?.route ?? "unknown",
    grantProfile: decision?.grantProfile ?? "none",
    reasonCodes: ["enrich_minimal_bundle"],
  };
  ctx.store.setSlice("contextBundle", bundle);
  return bundle;
}
