import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type ChangelogStrategy = 'keep_a_changelog' | 'conventional_changelog' | 'changesets' | 'release_please' | 'custom' | 'none';

export interface ChangelogStrategyDetection {
  strategy: ChangelogStrategy;
  currentVersion?: string;
  latestTag?: string;
  changelogPath?: string;
  expectedSectionFormat?: string;
  updateRecommendation: string;
}

export interface ChangelogEntry {
  type: string;
  summary: string;
  breaking: boolean;
  prRefs: string[];
}

export interface ChangelogAggregation {
  range: string;
  entries: ChangelogEntry[];
  breakingChanges: ChangelogEntry[];
  fixes: ChangelogEntry[];
  features: ChangelogEntry[];
  security: ChangelogEntry[];
  docs: ChangelogEntry[];
}

export function detectChangelogStrategy(workspace: string, options: { latestTag?: string } = {}): ChangelogStrategyDetection {
  const changelogPath = ['CHANGELOG.md', 'CHANGELOG', 'docs/CHANGELOG.md'].find((rel) => existsSync(join(workspace, rel)));
  const packageJsonPath = join(workspace, 'package.json');
  const packageJson = existsSync(packageJsonPath) ? safeJson(readFileSync(packageJsonPath, 'utf8')) : undefined;
  const hasChangesets = existsSync(join(workspace, '.changeset', 'config.json'));
  const hasReleasePlease = ['release-please-config.json', '.release-please-manifest.json'].some((rel) => existsSync(join(workspace, rel)));
  const changelogText = changelogPath ? readFileSync(join(workspace, changelogPath), 'utf8') : '';
  const strategy: ChangelogStrategy = hasChangesets
    ? 'changesets'
    : hasReleasePlease
      ? 'release_please'
      : /## \[?Unreleased\]?|Keep a Changelog/i.test(changelogText)
        ? 'keep_a_changelog'
        : /conventional-?changelog/i.test(JSON.stringify(packageJson ?? {}))
          ? 'conventional_changelog'
          : changelogPath
            ? 'custom'
            : 'none';
  return {
    strategy,
    currentVersion: typeof packageJson?.version === 'string' ? packageJson.version : undefined,
    latestTag: options.latestTag,
    changelogPath,
    expectedSectionFormat: strategy === 'keep_a_changelog' ? '## [Unreleased] with Added/Changed/Fixed subsections' : changelogPath ? 'Preserve existing heading style' : undefined,
    updateRecommendation: strategy === 'none' ? 'Create CHANGELOG.md before applying release notes.' : `Update ${changelogPath} using ${strategy}.`,
  };
}

export function aggregateChangelog(commits: string[], range = 'HEAD'): ChangelogAggregation {
  const entries = commits
    .map(parseCommitForChangelog)
    .filter((entry): entry is ChangelogEntry => Boolean(entry))
    .filter((entry, index, all) => all.findIndex((other) => other.summary === entry.summary && other.type === entry.type) === index);
  return {
    range,
    entries,
    breakingChanges: entries.filter((entry) => entry.breaking),
    fixes: entries.filter((entry) => entry.type === 'fix'),
    features: entries.filter((entry) => entry.type === 'feat'),
    security: entries.filter((entry) => entry.type === 'security'),
    docs: entries.filter((entry) => entry.type === 'docs'),
  };
}

export function generateChangelogPatch(
  existing: string,
  aggregation: ChangelogAggregation,
  version = 'Unreleased'
): { nextContent: string; preview: string; valid: boolean } {
  const section = renderChangelogSection(version, aggregation);
  let nextContent: string;
  if (/## \[?Unreleased\]?/i.test(existing)) {
    nextContent = existing.replace(/## \[?Unreleased\]?[\s\S]*?(?=\n## |\s*$)/i, section.trimEnd());
  } else {
    nextContent = `${section.trimEnd()}\n\n${existing.trimStart()}`;
  }
  return {
    nextContent,
    preview: section,
    valid: /^#|^##/m.test(nextContent) && !hasDuplicateHeadings(nextContent),
  };
}

function parseCommitForChangelog(commit: string): ChangelogEntry | undefined {
  const subject = commit.replace(/^[a-f0-9]{7,40}\s+/i, '').trim();
  if (!subject || /^merge\b/i.test(subject)) return undefined;
  const match = subject.match(/^(\w+)(?:\([^)]+\))?(!)?:\s*(.+)$/);
  const type = normalizeType(match?.[1] ?? 'changed');
  const summary = (match?.[3] ?? subject).replace(/\s+\(#\d+\)$/, '').trim();
  const prRefs = Array.from(subject.matchAll(/#(\d+)/g)).map((pr) => `#${pr[1]}`);
  return { type, summary, breaking: Boolean(match?.[2] || /BREAKING CHANGE/i.test(commit)), prRefs };
}

function normalizeType(type: string): string {
  if (type === 'feature') return 'feat';
  if (['fix', 'feat', 'docs', 'perf', 'security', 'deprecated', 'removed'].includes(type)) return type;
  return 'changed';
}

function renderChangelogSection(version: string, aggregation: ChangelogAggregation): string {
  const groups: Array<[string, ChangelogEntry[]]> = [
    ['Breaking Changes', aggregation.breakingChanges],
    ['Added', aggregation.features],
    ['Fixed', aggregation.fixes],
    ['Security', aggregation.security],
    ['Documentation', aggregation.docs],
    ['Changed', aggregation.entries.filter((entry) => !['feat', 'fix', 'security', 'docs'].includes(entry.type) && !entry.breaking)],
  ];
  const body = groups
    .filter(([, entries]) => entries.length > 0)
    .map(([heading, entries]) => [`### ${heading}`, ...entries.map((entry) => `- ${entry.summary}${entry.prRefs.length ? ` (${entry.prRefs.join(', ')})` : ''}`)].join('\n'))
    .join('\n\n');
  return `## ${version}\n\n${body || '- No user-facing changes identified.'}\n`;
}

function hasDuplicateHeadings(content: string): boolean {
  const headings = content.split(/\r?\n/).filter((line) => /^##\s+/.test(line));
  return new Set(headings).size !== headings.length;
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
