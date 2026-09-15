import type {
  ReviewParsedInput,
  ReviewResolvedRule,
  ReviewRuleGroup,
  ReviewWarning,
} from "../contracts";
import { matchGlob, normalizeRelativePath } from "../internal/pathUtils";
import { BUNDLED_SYSTEM_RULES } from "../bundled-rules/catalog";

/**
 * First-match-wins path rule resolution.
 * Layers (high → low): rulesConfig.rules → input.systemRules → bundled defaults.
 */
export function resolveReviewRules(params: {
  paths: readonly string[];
  input: ReviewParsedInput;
}): {
  rules: ReviewResolvedRule[];
  ruleGroups: ReviewRuleGroup[];
  warnings: ReviewWarning[];
} {
  const warnings: ReviewWarning[] = [];
  const layers: Array<{ pattern: string; rule: string; source: string }> = [];

  for (const override of params.input.rulesConfig?.rules ?? []) {
    layers.push({
      pattern: override.path,
      rule: override.rule,
      source: "workspace",
    });
  }
  for (const system of params.input.systemRules) {
    layers.push({
      pattern: system.pattern,
      rule: system.rule,
      source: system.source,
    });
  }
  for (const bundled of BUNDLED_SYSTEM_RULES) {
    layers.push(bundled);
  }

  const rules: ReviewResolvedRule[] = [];
  for (const path of params.paths) {
    const normalized = normalizeRelativePath(path);
    let matched:
      | { pattern: string; rule: string; source: string }
      | undefined;
    for (const layer of layers) {
      if (matchGlob(normalized, layer.pattern) || matchGlob(normalized, `**/${layer.pattern}`)) {
        matched = layer;
        break;
      }
    }
    if (!matched) {
      warnings.push({
        code: "rule_missing",
        message: `No specific rule for ${normalized}; using default.`,
      });
      matched = {
        pattern: "**/*",
        rule: DEFAULT_RULE,
        source: "default",
      };
    }
    // mergeSystemRule: if workspace override requests merge, append bundled match
    const workspaceOverride = (params.input.rulesConfig?.rules ?? []).find(
      (r) =>
        matchGlob(normalized, r.path) || matchGlob(normalized, `**/${r.path}`),
    );
    let ruleText = matched.rule;
    if (workspaceOverride?.mergeSystemRule) {
      const bundled = BUNDLED_SYSTEM_RULES.find(
        (b) =>
          matchGlob(normalized, b.pattern) ||
          matchGlob(normalized, `**/${b.pattern}`),
      );
      if (bundled && matched.source === "workspace") {
        ruleText = `${workspaceOverride.rule}\n\n---\n\n${bundled.rule}`;
      }
    }
    rules.push({
      path: normalized,
      pattern: matched.pattern,
      source: matched.source,
      rule: ruleText,
    });
  }

  const groupMap = new Map<string, ReviewRuleGroup>();
  for (const resolved of rules) {
    const key = `${resolved.source}::${resolved.pattern}::${resolved.rule}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.paths.push(resolved.path);
    } else {
      groupMap.set(key, {
        pattern: resolved.pattern,
        source: resolved.source,
        rule: resolved.rule,
        paths: [resolved.path],
      });
    }
  }

  return {
    rules,
    ruleGroups: [...groupMap.values()],
    warnings,
  };
}

const DEFAULT_RULE = `Review for correctness, security, readability, tests, and operational risk.
Prefer severity-labeled findings. Anchor every finding to existing code.`;
