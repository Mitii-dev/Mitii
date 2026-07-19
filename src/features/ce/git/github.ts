import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { canonicalGitActionSignature } from './intents';

export interface GitHubRepositoryInfo {
  owner: string;
  name: string;
  remoteUrl: string;
}

export interface GitHubRepositoryVerification {
  ok: boolean;
  repository?: GitHubRepositoryInfo;
  expectedBranch?: string;
  authenticatedUser?: string;
  writePermission?: boolean;
  isFork?: boolean;
  errors: string[];
}

export interface PullRequestDraft {
  title: string;
  body: string;
  base: string;
  head: string;
  idempotencyKey: string;
}

export type GitHubIssueKind = 'bug' | 'feature' | 'technical_debt' | 'security_safe' | 'documentation' | 'performance' | 'task';

export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
  acceptanceCriteria: string[];
  idempotencyKey: string;
}

export interface DuplicateIssueCandidate {
  number: number;
  title: string;
  url?: string;
  confidence: number;
}

export function parseGitHubRemoteUrl(remoteUrl: string): GitHubRepositoryInfo | undefined {
  const trimmed = remoteUrl.trim().replace(/\.git$/, '');
  const https = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  const match = https ?? ssh;
  if (!match) return undefined;
  return { owner: match[1], name: match[2], remoteUrl };
}

export function verifyGitHubRepository(input: {
  remoteUrl: string;
  expectedBranch?: string;
  currentBranch?: string;
  authenticatedUser?: string;
  writePermission?: boolean;
  isFork?: boolean;
}): GitHubRepositoryVerification {
  const repository = parseGitHubRemoteUrl(input.remoteUrl);
  const errors: string[] = [];
  if (!repository) errors.push('Remote URL is not a GitHub repository URL.');
  if (input.expectedBranch && input.currentBranch && input.expectedBranch !== input.currentBranch) {
    errors.push(`Current branch ${input.currentBranch} does not match expected branch ${input.expectedBranch}.`);
  }
  if (!input.authenticatedUser) errors.push('Authenticated GitHub identity is not available.');
  if (input.writePermission === false) errors.push('Authenticated identity does not have write permission.');
  if (input.isFork) errors.push('Target repository appears to be a fork; confirm this is intended before remote writes.');
  return {
    ok: errors.length === 0,
    repository,
    expectedBranch: input.expectedBranch,
    authenticatedUser: input.authenticatedUser,
    writePermission: input.writePermission,
    isFork: input.isFork,
    errors,
  };
}

export function buildPullRequestDraft(input: {
  base: string;
  head: string;
  commits: string[];
  changedFiles: string[];
  testsRun?: string[];
  issueRefs?: string[];
  template?: string;
  riskIndicators?: string[];
}): PullRequestDraft {
  const title = firstMeaningfulSubject(input.commits) || `Update ${input.changedFiles[0] ?? 'workspace'}`;
  const body = [
    input.template?.trim(),
    '## Summary',
    ...summarizeFiles(input.changedFiles).map((line) => `- ${line}`),
    '',
    '## Testing',
    input.testsRun?.length ? input.testsRun.map((test) => `- ${test}`).join('\n') : '- Not run',
    '',
    '## Risks',
    input.riskIndicators?.length ? input.riskIndicators.map((risk) => `- ${risk}`).join('\n') : '- No specific risks identified',
    '',
    input.issueRefs?.length ? `## Related Issues\n${input.issueRefs.map((ref) => `- ${ref}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return {
    title: title.slice(0, 120),
    body: redactSensitiveText(body),
    base: input.base,
    head: input.head,
    idempotencyKey: canonicalGitActionSignature('github_pr', { base: input.base, head: input.head }),
  };
}

export function buildIssueDraft(input: {
  kind: GitHubIssueKind;
  title: string;
  report: string;
  component?: string;
  labels?: string[];
}): IssueDraft {
  const title = normalizeIssueTitle(input.title);
  const acceptanceCriteria = inferAcceptanceCriteria(input.report);
  const body = [
    `## Type\n${input.kind}`,
    input.component ? `## Component\n${input.component}` : '',
    `## Details\n${redactSensitiveText(input.report)}`,
    '## Acceptance Criteria',
    ...acceptanceCriteria.map((criterion) => `- ${criterion}`),
  ].filter(Boolean).join('\n\n');
  return {
    title,
    body,
    labels: input.labels ?? defaultLabelsForIssueKind(input.kind),
    acceptanceCriteria,
    idempotencyKey: canonicalGitActionSignature('github_issue', { title: normalizeForDuplicateSearch(title) }),
  };
}

export function findDuplicateIssues(
  input: { title: string; body?: string; component?: string },
  issues: Array<{ number: number; title: string; body?: string; url?: string }>
): DuplicateIssueCandidate[] {
  const queryTitle = normalizeForDuplicateSearch(input.title);
  const signatures = extractErrorSignatures(`${input.title}\n${input.body ?? ''}`);
  return issues
    .map((issue) => {
      const title = normalizeForDuplicateSearch(issue.title);
      let confidence = title === queryTitle ? 0.98 : tokenOverlap(queryTitle, title);
      if (input.component && issue.body?.toLowerCase().includes(input.component.toLowerCase())) confidence += 0.1;
      if (signatures.some((signature) => issue.body?.includes(signature))) confidence += 0.2;
      return { number: issue.number, title: issue.title, url: issue.url, confidence: Math.min(1, confidence) };
    })
    .filter((candidate) => candidate.confidence >= 0.45)
    .sort((a, b) => b.confidence - a.confidence);
}

export function readRepositoryTemplate(workspace: string, type: 'pull_request' | 'issue'): string | undefined {
  const candidates = type === 'pull_request'
    ? ['.github/pull_request_template.md', 'PULL_REQUEST_TEMPLATE.md']
    : ['.github/ISSUE_TEMPLATE/bug_report.md', '.github/issue_template.md', 'ISSUE_TEMPLATE.md'];
  for (const relPath of candidates) {
    const absPath = join(workspace, relPath);
    if (existsSync(absPath)) return readFileSync(absPath, 'utf8');
  }
  if (type === 'issue') {
    const dir = join(workspace, '.github', 'ISSUE_TEMPLATE');
    if (existsSync(dir)) {
      const first = readdirSync(dir).find((entry) => /\.(md|yml|yaml)$/i.test(entry));
      if (first) return readFileSync(join(dir, first), 'utf8');
    }
  }
  return undefined;
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/(gh[pousr]_[A-Za-z0-9_]{20,})/g, '[redacted github token]')
    .replace(/(AKIA[0-9A-Z]{16})/g, '[redacted aws key]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[redacted token]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/]+:)[^@\s]+(@)/gi, '$1[redacted]$2')
    .replace(/(password|token|secret|api[_-]?key)\s*[:=]\s*["']?[^"'\s]+/gi, '$1=[redacted]');
}

function firstMeaningfulSubject(commits: string[]): string | undefined {
  return commits.map((commit) => commit.replace(/^[a-f0-9]{7,40}\s+/i, '').trim()).find((subject) => subject && !/^merge\b/i.test(subject));
}

function summarizeFiles(files: string[]): string[] {
  if (files.length === 0) return ['Repository changes ready for review'];
  const shown = files.slice(0, 8).map((file) => `Updated ${file}`);
  if (files.length > shown.length) shown.push(`Updated ${files.length - shown.length} additional files`);
  return shown;
}

function normalizeIssueTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').slice(0, 160);
}

function normalizeForDuplicateSearch(value: string): string {
  return value.toLowerCase().replace(/[`"'()[\]{}:;,.!?]/g, ' ').replace(/\s+/g, ' ').trim();
}

function inferAcceptanceCriteria(report: string): string[] {
  const lines = report.split(/\r?\n/).map((line) => line.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
  const explicit = lines.filter((line) => /\b(should|must|acceptance|done when|verify)\b/i.test(line)).slice(0, 5);
  return explicit.length > 0 ? explicit : ['The reported behavior is reproduced or clarified', 'A fix or implementation plan is documented', 'Relevant validation is identified'];
}

function defaultLabelsForIssueKind(kind: GitHubIssueKind): string[] {
  const labels: Record<GitHubIssueKind, string[]> = {
    bug: ['bug'],
    feature: ['enhancement'],
    technical_debt: ['technical debt'],
    security_safe: ['security'],
    documentation: ['documentation'],
    performance: ['performance'],
    task: ['task'],
  };
  return labels[kind];
}

function extractErrorSignatures(text: string): string[] {
  return Array.from(text.matchAll(/\b(?:error|exception|failed|panic|trace):?\s+([^\n]{8,120})/gi)).map((match) => match[0]);
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(a.split(' ').filter((token) => token.length > 2));
  const bTokens = new Set(b.split(' ').filter((token) => token.length > 2));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap += 1;
  return overlap / Math.max(aTokens.size, bTokens.size);
}
