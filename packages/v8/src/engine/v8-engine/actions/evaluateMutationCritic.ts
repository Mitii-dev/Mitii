import type { DecisionBrief } from "../../../modules/decision-policy";
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { SteeringCriticMode } from "../legacy/steeringFlags";

export const MUTATION_CRITIC_VERDICTS = [
  "pass",
  "revise",
  "stop_and_clarify",
] as const;

export type MutationCriticVerdict = (typeof MUTATION_CRITIC_VERDICTS)[number];

export interface MutationCriticInput {
  decision: ExecutionDecision;
  brief?: DecisionBrief;
  /** Proposed mutating tool names for this batch. */
  mutationToolNames: readonly string[];
  /** Paths the batch intends to touch (best-effort). */
  intendedPaths?: readonly string[];
  /**
   * Explicit ask-scoped file/folder targets from request understanding.
   * When present, a batch that touches none of them is revise (wrong-target).
   */
  askScopedPaths?: readonly string[];
  /** Short plan / assistant narration snippet. */
  proposedSummary?: string;
  mode: SteeringCriticMode;
}

export interface MutationCriticResult {
  verdict: MutationCriticVerdict;
  reasons: string[];
  /** When enforce + revise/stop, Engine may narrow path scopes to these. */
  narrowToPaths?: string[];
  /** Shadow mode: would have blocked but did not. */
  shadowWouldBlock: boolean;
}

/**
 * Deterministic pre-mutation critic (narrow/pause only — never widen).
 * No LLM required for v1; evaluates grant/brief consistency.
 */
export function evaluateMutationCritic(
  input: MutationCriticInput,
): MutationCriticResult {
  if (input.mode === "off") {
    return { verdict: "pass", reasons: [], shadowWouldBlock: false };
  }

  const reasons: string[] = [];
  const decision = input.decision;
  const grant = decision.toolGrant;

  if (decision.route !== "execute" || grant.maximumWorkspaceEffect !== "write") {
    if (input.mutationToolNames.length > 0) {
      reasons.push(
        `Mutation tools proposed on non-write route=${decision.route} effect=${grant.maximumWorkspaceEffect}.`,
      );
      return finalize("stop_and_clarify", reasons, input.mode);
    }
    return { verdict: "pass", reasons: [], shadowWouldBlock: false };
  }

  if (input.mutationToolNames.length === 0) {
    return { verdict: "pass", reasons: [], shadowWouldBlock: false };
  }

  const allowed = new Set(grant.allowedTools);
  for (const name of input.mutationToolNames) {
    if (!allowed.has(name)) {
      reasons.push(`Tool ${name} is not in the granted allowlist.`);
    }
  }

  const scopes = grant.mutationPathScopes?.length
    ? grant.mutationPathScopes.map((s) => s.replace(/\\/g, "/"))
    : grant.pathScopes.map((s) => s.replace(/\\/g, "/"));
  const outOfScope: string[] = [];
  for (const raw of input.intendedPaths ?? []) {
    const path = raw.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!path) continue;
    if (scopes.includes("**") || scopes.includes(".") || scopes.includes("./")) {
      continue;
    }
    const inScope = scopes.some(
      (scope) =>
        path === scope ||
        path.startsWith(scope.endsWith("/") ? scope : `${scope}/`) ||
        (scope.endsWith("/**") &&
          path.startsWith(scope.slice(0, -3).replace(/\/$/, "") + "/")),
    );
    if (!inScope) {
      outOfScope.push(path);
    }
  }
  if (outOfScope.length > 0) {
    reasons.push(
      `Intended paths out of grant scope: ${outOfScope.slice(0, 5).join(", ")}.`,
    );
  }

  const askScoped = (input.askScopedPaths ?? [])
    .map((p) => p.replace(/\\/g, "/").replace(/^\.\//, ""))
    .filter((p) => p.length > 0);
  const intendedNormalized = (input.intendedPaths ?? [])
    .map((p) => p.replace(/\\/g, "/").replace(/^\.\//, ""))
    .filter((p) => p.length > 0);
  if (askScoped.length > 0 && intendedNormalized.length > 0) {
    const matchesAsk = (path: string): boolean =>
      askScoped.some((ask) => {
        const askDir = ask.endsWith("/") ? ask : `${ask}/`;
        const pathDir = path.endsWith("/") ? path : `${path}/`;
        return (
          path === ask ||
          path.startsWith(askDir) ||
          ask.startsWith(pathDir) ||
          // basename equality for bare filenames in ask
          (ask.includes("/") === false &&
            (path === ask || path.endsWith(`/${ask}`)))
        );
      });
    const wrongTarget = intendedNormalized.every((path) => !matchesAsk(path));
    if (wrongTarget) {
      reasons.push(
        `Intended paths do not match ask-scoped targets (${askScoped
          .slice(0, 4)
          .join(", ")}); proposed: ${intendedNormalized.slice(0, 4).join(", ")}.`,
      );
    }
  }

  if (input.brief) {
    const summary = (input.proposedSummary ?? "").toLowerCase();
    for (const ban of input.brief.mustNotDo) {
      if (/do not claim you are applying edits/i.test(ban) && /applied|wrote|patched/i.test(summary)) {
        // Narration inconsistency is revise, not stop — tools may still be valid.
        reasons.push("Proposed narration conflicts with read-oriented mustNotDo.");
      }
    }
    if (
      input.brief.mustDo.some((m) => /analyze_change_impact/i.test(m)) &&
      !input.mutationToolNames.includes("analyze_change_impact") &&
      summary.length > 0 &&
      /patch|apply|write/.test(summary) &&
      !/analyze_change_impact|impact analysis/.test(summary)
    ) {
      reasons.push(
        "Brief requires change-impact analysis before shared mutations.",
      );
    }
  }

  if (reasons.length === 0) {
    return { verdict: "pass", reasons: [], shadowWouldBlock: false };
  }

  const verdict: MutationCriticVerdict =
    outOfScope.length > 0 ||
    reasons.some((r) => /not in the granted allowlist/i.test(r))
      ? "stop_and_clarify"
      : "revise";

  const narrowToPaths =
    verdict === "revise" && (input.intendedPaths?.length ?? 0) > 0
      ? (input.intendedPaths ?? [])
          .map((p) => p.replace(/\\/g, "/").replace(/^\.\//, ""))
          .filter((p) => p.length > 0)
          .slice(0, 20)
      : undefined;

  return finalize(verdict, reasons, input.mode, narrowToPaths);
}

function finalize(
  verdict: MutationCriticVerdict,
  reasons: string[],
  mode: SteeringCriticMode,
  narrowToPaths?: string[],
): MutationCriticResult {
  if (mode === "shadow") {
    return {
      verdict: "pass",
      reasons,
      narrowToPaths,
      shadowWouldBlock: verdict !== "pass",
    };
  }
  return {
    verdict,
    reasons,
    narrowToPaths,
    shadowWouldBlock: false,
  };
}
