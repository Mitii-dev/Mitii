/**
 * Host recipe: turn structured Mitii review findings into an Agent ask.
 *
 * Architecture: V8 `review` stays diagnose-only (no mutation). The host
 * compiles findings → prompt + forced skill + agent mode. Decision Policy
 * still owns ToolGrant.
 */

export const FIX_REVIEW_FINDINGS_SKILL_ID = 'fix-review-findings';

export const FIX_REVIEW_FINDINGS_RECIPE_ID = 'fix-review-findings' as const;

const MAX_FINDINGS = 32;
const MAX_CONTENT_CHARS = 1_200;
const MAX_CODE_CHARS = 800;

export type FixReviewFindingInput = {
  path: string;
  content: string;
  startLine?: number;
  endLine?: number;
  severity?: string;
  category?: string;
  existingCode?: string;
  suggestionCode?: string;
};

export type BuildFixReviewFindingsAskOptions = {
  findings: readonly FixReviewFindingInput[];
  /** When true, prompt language targets a single finding. */
  single?: boolean;
};

export type FixReviewFindingsAsk = {
  recipeId: typeof FIX_REVIEW_FINDINGS_RECIPE_ID;
  label: string;
  prompt: string;
  mode: 'agent';
  requiredSkillIds: string[];
  /** Distinct relative paths to pin into context. */
  pinnedPaths: string[];
};

/**
 * Compile structured review findings into an Agent start payload.
 * Throws if there are no usable findings (empty path/content).
 */
export function buildFixReviewFindingsAsk(
  options: BuildFixReviewFindingsAskOptions,
): FixReviewFindingsAsk {
  const normalized = normalizeFindings(options.findings);
  if (normalized.length === 0) {
    throw new Error(
      'fix-review-findings recipe requires at least one finding with path and content.',
    );
  }

  const single = options.single === true || normalized.length === 1;
  const sorted = sortFindings(normalized);
  const pinnedPaths = uniquePaths(sorted);

  const header = single
    ? 'Fix this Mitii review finding. Apply the smallest safe edit; do not re-review or call emit_review_finding.'
    : `Fix all ${sorted.length} Mitii review findings below. Apply the smallest safe edits; do not re-review or call emit_review_finding.`;

  const body = sorted
    .map((finding, index) => formatFindingBlock(finding, index + 1))
    .join('\n\n');

  const footer = [
    'Constraints:',
    '- Stay on the listed paths unless a finding requires one direct dependency.',
    '- Prefer suggestionCode when present and still applicable.',
    '- After edits, summarize what you changed in a few bullets.',
  ].join('\n');

  return {
    recipeId: FIX_REVIEW_FINDINGS_RECIPE_ID,
    label: single ? 'Fix review finding' : 'Fix all review findings',
    prompt: `${header}\n\n${body}\n\n${footer}`,
    mode: 'agent',
    requiredSkillIds: [FIX_REVIEW_FINDINGS_SKILL_ID],
    pinnedPaths,
  };
}

function normalizeFindings(
  findings: readonly FixReviewFindingInput[],
): FixReviewFindingInput[] {
  const out: FixReviewFindingInput[] = [];
  for (const raw of findings.slice(0, MAX_FINDINGS)) {
    const path = String(raw.path ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\//, '');
    const content = String(raw.content ?? '').trim();
    if (!path || !content) continue;
    out.push({
      path,
      content: truncate(content, MAX_CONTENT_CHARS),
      startLine: positiveInt(raw.startLine),
      endLine: positiveInt(raw.endLine),
      severity: raw.severity?.trim() || undefined,
      category: raw.category?.trim() || undefined,
      existingCode: raw.existingCode?.trim()
        ? truncate(raw.existingCode.trim(), MAX_CODE_CHARS)
        : undefined,
      suggestionCode: raw.suggestionCode?.trim()
        ? truncate(raw.suggestionCode.trim(), MAX_CODE_CHARS)
        : undefined,
    });
  }
  return out;
}

function sortFindings(
  findings: readonly FixReviewFindingInput[],
): FixReviewFindingInput[] {
  return [...findings].sort((a, b) => {
    const sev = severityRank(a.severity) - severityRank(b.severity);
    if (sev !== 0) return sev;
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    return (a.startLine ?? 0) - (b.startLine ?? 0);
  });
}

function formatFindingBlock(
  finding: FixReviewFindingInput,
  ordinal: number,
): string {
  const loc =
    finding.startLine != null
      ? `${finding.path}:${finding.startLine}${
          finding.endLine != null && finding.endLine !== finding.startLine
            ? `-${finding.endLine}`
            : ''
        }`
      : finding.path;
  const meta = [
    finding.severity ? `severity=${finding.severity}` : null,
    finding.category ? `category=${finding.category}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const lines = [
    `### Finding ${ordinal}`,
    `- Location: ${loc}`,
    meta ? `- ${meta}` : null,
    `- Issue: ${finding.content}`,
  ].filter((line): line is string => Boolean(line));

  if (finding.existingCode) {
    lines.push('- existingCode:', '```', finding.existingCode, '```');
  }
  if (finding.suggestionCode) {
    lines.push('- suggestionCode:', '```', finding.suggestionCode, '```');
  }
  return lines.join('\n');
}

function uniquePaths(findings: readonly FixReviewFindingInput[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const finding of findings) {
    if (seen.has(finding.path)) continue;
    seen.add(finding.path);
    paths.push(finding.path);
  }
  return paths;
}

function severityRank(severity: string | undefined): number {
  switch ((severity ?? 'medium').toLowerCase()) {
    case 'critical':
    case 'blocker':
      return 0;
    case 'high':
    case 'error':
      return 1;
    case 'medium':
    case 'warning':
      return 2;
    case 'low':
    case 'nit':
      return 3;
    case 'info':
    case 'hint':
    case 'fyi':
      return 4;
    default:
      return 2;
  }
}

function positiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  return n > 0 ? n : undefined;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
