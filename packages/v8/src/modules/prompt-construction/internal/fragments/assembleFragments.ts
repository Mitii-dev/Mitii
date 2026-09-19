import type { TokenEstimatorPort } from "../../contracts";
import {
  matchesMarkedFragment,
  renderFragment,
  type ContextualFragment,
  type RenderedFragment,
} from "./ContextualFragment";
import { FRAGMENT_POLICY } from "./fragmentPolicy";

export type FragmentTruncateFn = (
  text: string,
  budgetTokens: number,
) => { content: string; usedTokens: number; truncatedTokens: number };

export interface AssembledFragmentOmission {
  id: string;
  contentKind: string;
  section: ReturnType<ContextualFragment["section"]>;
  tokens: number;
  reason: "budget" | "absolute_cap" | "empty";
}

export interface AssembledFragments {
  /** Joined text for a single system message (non-separate fragments). */
  content: string;
  usedTokens: number;
  truncatedTokens: number;
  omittedTokens: number;
  included: RenderedFragment[];
  omissions: AssembledFragmentOmission[];
  /** Fragments that crossed the Codex P0 review threshold. */
  reviewFlaggedIds: string[];
  /** Separate-message fragments (Codex requires_separate_message). */
  separateMessages: RenderedFragment[];
}

/**
 * Assemble typed fragments under a shared token budget with Codex hard caps.
 *
 * Formulae:
 * - Each fragment is capped by `fragment.maxTokens()` before budget admission.
 * - Fragments that still cannot fit the remaining section budget are omitted
 *   (or truncated once when remaining > 40), matching Mitii instruction packing.
 * - Items above `reviewThresholdTokens` are flagged, not auto-rejected.
 */
export function assembleFragments(params: {
  fragments: readonly ContextualFragment[];
  estimator: TokenEstimatorPort;
  budgetTokens: number;
  truncateToBudget: FragmentTruncateFn;
}): AssembledFragments {
  let remaining = Math.max(0, params.budgetTokens);
  let usedTokens = 0;
  let truncatedTokens = 0;
  let omittedTokens = 0;
  const included: RenderedFragment[] = [];
  const separateMessages: RenderedFragment[] = [];
  const omissions: AssembledFragmentOmission[] = [];
  const reviewFlaggedIds: string[] = [];
  const parts: string[] = [];

  for (const fragment of params.fragments) {
    const body = fragment.body();
    if (!body.trim()) {
      omissions.push({
        id: fragment.id,
        contentKind: fragment.contentKind(),
        section: fragment.section(),
        tokens: 0,
        reason: "empty",
      });
      continue;
    }

    const absoluteCap = Math.min(
      fragment.maxTokens(),
      FRAGMENT_POLICY.absoluteMaxTokens,
    );
    if (absoluteCap <= 0) {
      const tokens = params.estimator.estimate(body);
      omissions.push({
        id: fragment.id,
        contentKind: fragment.contentKind(),
        section: fragment.section(),
        tokens,
        reason: "absolute_cap",
      });
      omittedTokens += tokens;
      continue;
    }

    const rendered = renderFragment(
      fragment,
      (text) => params.estimator.estimate(text),
      params.truncateToBudget,
    );

    if (rendered.tokens > FRAGMENT_POLICY.reviewThresholdTokens) {
      reviewFlaggedIds.push(fragment.id);
    }

    if (rendered.tokens <= remaining) {
      admit(rendered, fragment);
      continue;
    }

    if (remaining > 40 && rendered.tokens > remaining) {
      const truncated = params.truncateToBudget(rendered.text, remaining);
      if (truncated.content.length > 0) {
        const admitted: RenderedFragment = {
          ...rendered,
          text: truncated.content,
          tokens: truncated.usedTokens,
          truncated: true,
          truncatedTokens:
            rendered.truncatedTokens + truncated.truncatedTokens,
        };
        admit(admitted, fragment);
        continue;
      }
    }

    omissions.push({
      id: fragment.id,
      contentKind: fragment.contentKind(),
      section: fragment.section(),
      tokens: rendered.tokens,
      reason: "budget",
    });
    omittedTokens += rendered.tokens;
  }

  return {
    content: parts.join("\n\n"),
    usedTokens,
    truncatedTokens,
    omittedTokens,
    included,
    omissions,
    reviewFlaggedIds,
    separateMessages,
  };

  function admit(
    rendered: RenderedFragment,
    fragment: ContextualFragment,
  ): void {
    if (fragment.requiresSeparateMessage()) {
      separateMessages.push(rendered);
    } else {
      parts.push(rendered.text);
      included.push(rendered);
    }
    usedTokens += rendered.tokens;
    truncatedTokens += rendered.truncatedTokens;
    remaining -= rendered.tokens;
  }
}

export function fragmentMatchesText(
  fragment: ContextualFragment,
  text: string,
): boolean {
  const [start, end] = fragment.markers();
  return matchesMarkedFragment(start, end, text);
}
