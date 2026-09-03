import { expandCodeIdentifierTerms } from "../../../repository-state";
import type { TaskTarget } from "../contracts";

export interface FuzzyFileTargetResolution {
  targets: TaskTarget[];
  /** Original → resolved path pairs for diagnostics. */
  resolved: ReadonlyArray<{ from: string; to: string }>;
}

/** Minimum CamelCase / stem term length for unique fuzzy resolution. */
const STEM_MATCH_MINIMUM_TERM_CHARACTERS = 4;

/**
 * After explicit path extraction, resolve basename / partial file targets
 * against a candidate path list (typically repo-map relative paths).
 *
 * Rules:
 * - Exact relative-path hits stay unchanged (casing may normalize).
 * - Basename-only or suffix matches resolve when exactly one candidate matches.
 * - Extensionless / PascalCase stems resolve when exactly one candidate stem
 *   matches (exact stem or unique identifier-term overlap via
 *   {@link expandCodeIdentifierTerms}).
 * - Ambiguous (2+) or zero matches leave the original target unchanged.
 * - Non-file targets are left unchanged.
 */
export function resolveFuzzyFileTargets(
  targets: readonly TaskTarget[],
  candidateRelativePaths: readonly string[],
): FuzzyFileTargetResolution {
  if (targets.length === 0 || candidateRelativePaths.length === 0) {
    return { targets: [...targets], resolved: [] };
  }

  const normalizedCandidates = uniqueNormalizedPaths(candidateRelativePaths);
  const byBasename = indexByBasename(normalizedCandidates);
  const byStem = indexByStem(normalizedCandidates);
  const resolved: Array<{ from: string; to: string }> = [];

  const next = targets.map((target) => {
    if (target.kind !== "file" || !target.explicit) {
      return target;
    }

    const raw = target.value.trim().replace(/\\/g, "/");
    if (!raw) {
      return target;
    }

    const exact = normalizedCandidates.find(
      (candidate) => candidate.toLowerCase() === raw.toLowerCase(),
    );
    if (exact) {
      if (exact !== target.value) {
        resolved.push({ from: target.value, to: exact });
        return { ...target, value: exact };
      }
      return target;
    }

    const suffixHits = normalizedCandidates.filter(
      (candidate) =>
        candidate.toLowerCase().endsWith(`/${raw.toLowerCase()}`) ||
        candidate.toLowerCase() === raw.toLowerCase(),
    );
    if (suffixHits.length === 1) {
      return takeResolved(target, suffixHits[0]!, resolved);
    }

    const base = basename(raw);
    if (base.includes(".")) {
      const basenameHits = byBasename.get(base.toLowerCase()) ?? [];
      if (basenameHits.length === 1) {
        return takeResolved(target, basenameHits[0]!, resolved);
      }
      // Extension present but basename ambiguous/missing — do not loosen
      // further with CamelCase terms (too easy to pick the wrong file).
      return target;
    }

    // Extensionless / PascalCase mention (e.g. "Desktop", "BillPage").
    const stemHit = resolveUniqueStemMatch(base, byStem, normalizedCandidates);
    if (stemHit) {
      return takeResolved(target, stemHit, resolved);
    }

    return target;
  });

  return { targets: next, resolved };
}

function takeResolved(
  target: TaskTarget,
  hit: string,
  resolved: Array<{ from: string; to: string }>,
): TaskTarget {
  if (hit !== target.value) {
    resolved.push({ from: target.value, to: hit });
  }
  return { ...target, value: hit };
}

/**
 * Unique stem match: exact stem first, then a single candidate whose
 * identifier expansion contains a long enough target term.
 */
function resolveUniqueStemMatch(
  stem: string,
  byStem: Map<string, string[]>,
  candidates: readonly string[],
): string | undefined {
  const needle = stem.trim();
  if (!needle) {
    return undefined;
  }

  const exactStemHits = byStem.get(needle.toLowerCase()) ?? [];
  if (exactStemHits.length === 1) {
    return exactStemHits[0];
  }
  if (exactStemHits.length > 1) {
    return undefined;
  }

  const terms = expandCodeIdentifierTerms(needle).filter(
    (term) => term.length >= STEM_MATCH_MINIMUM_TERM_CHARACTERS,
  );
  if (terms.length === 0) {
    return undefined;
  }

  const hits = new Set<string>();
  for (const candidate of candidates) {
    const candidateStem = stripExtension(basename(candidate));
    const expanded = new Set(expandCodeIdentifierTerms(candidateStem));
    // Require an exact identifier-term hit (not substring). "bill" must not
    // match stem "billing" — only expanded token equality counts.
    if (terms.some((term) => expanded.has(term))) {
      hits.add(candidate);
      if (hits.size > 1) {
        return undefined;
      }
    }
  }

  if (hits.size === 1) {
    return [...hits][0];
  }
  return undefined;
}

function uniqueNormalizedPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const normalized = path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function indexByBasename(paths: readonly string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const path of paths) {
    const base = basename(path).toLowerCase();
    const list = map.get(base);
    if (list) {
      list.push(path);
    } else {
      map.set(base, [path]);
    }
  }
  return map;
}

function indexByStem(paths: readonly string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const path of paths) {
    const stem = stripExtension(basename(path)).toLowerCase();
    if (!stem) {
      continue;
    }
    const list = map.get(stem);
    if (list) {
      list.push(path);
    } else {
      map.set(stem, [path]);
    }
  }
  return map;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0) {
    return filename;
  }
  return filename.slice(0, idx);
}
