import { createHash } from 'crypto';

export type GitIntent =
  | 'git_status_summary'
  | 'git_diff_analysis'
  | 'git_commit_message'
  | 'git_history_analysis'
  | 'git_blame_analysis'
  | 'git_branch_compare'
  | 'git_branch_create'
  | 'git_branch_delete'
  | 'git_changelog_update'
  | 'git_commit'
  | 'git_commit_amend'
  | 'git_merge'
  | 'git_rebase'
  | 'git_tag_create'
  | 'git_release_prepare'
  | 'github_pr_draft'
  | 'github_pr_create'
  | 'github_pr_review'
  | 'github_pr_comment'
  | 'github_pr_merge'
  | 'github_issue_draft'
  | 'github_issue_create'
  | 'github_issue_update'
  | 'github_workflow_analyze'
  | 'github_workflow_update'
  | 'github_workflow_dispatch'
  | 'github_release_create';

export type GitRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type GitApprovalRequirement = 'none' | 'policy' | 'explicit' | 'always_explicit';
export type GitWriteClass = 'read_only' | 'workspace_write' | 'local_git_write' | 'remote_write';
export type GitRoute =
  | 'git_read'
  | 'git_commit_message'
  | 'git_history'
  | 'git_workspace_edit'
  | 'git_local_write'
  | 'github_remote_write'
  | 'github_actions'
  | 'release_management';

export interface GitIntentMetadata {
  intent: GitIntent;
  writeClass: GitWriteClass;
  readOnly: boolean;
  workspaceWrite: boolean;
  localGitWrite: boolean;
  remoteWrite: boolean;
  destructive: boolean;
  risk: GitRiskLevel;
  approval: GitApprovalRequirement;
  description: string;
}

export interface GitIntentClassification {
  primaryIntent: GitIntent | 'unknown_git';
  secondaryIntents: GitIntent[];
  confidence: number;
  scope: string;
  requiresWorkspaceWrite: boolean;
  requiresGitWrite: boolean;
  requiresRemoteWrite: boolean;
  requiresApproval: boolean;
  metadata?: GitIntentMetadata;
}

export interface GitRouteResolution {
  isGitTask: boolean;
  route: GitRoute | 'general_agent';
  classification: GitIntentClassification;
  risk: GitRiskLevel;
  requiredApproval: GitApprovalRequirement;
  allowedTools: string[];
  selectedSkills: GitSkillSelection;
  telemetry: GitIntentTelemetry;
}

export interface GitSkillSelection {
  primarySkill?: string;
  additionalSkills: string[];
  candidates: Array<{ skill: string; score: number; reason: string }>;
  rejected: Array<{ skill: string; reason: string }>;
  injected: string[];
}

export interface GitIntentTelemetry {
  detectedIntent: GitIntent | 'unknown_git';
  confidence: number;
  scope: string;
  route: GitRoute | 'general_agent';
  risk: GitRiskLevel;
  writeClass: GitWriteClass | 'unknown';
  approval: GitApprovalRequirement;
}

export const GIT_INTENTS: readonly GitIntent[] = [
  'git_status_summary',
  'git_diff_analysis',
  'git_commit_message',
  'git_history_analysis',
  'git_blame_analysis',
  'git_branch_compare',
  'git_branch_create',
  'git_branch_delete',
  'git_changelog_update',
  'git_commit',
  'git_commit_amend',
  'git_merge',
  'git_rebase',
  'git_tag_create',
  'git_release_prepare',
  'github_pr_draft',
  'github_pr_create',
  'github_pr_review',
  'github_pr_comment',
  'github_pr_merge',
  'github_issue_draft',
  'github_issue_create',
  'github_issue_update',
  'github_workflow_analyze',
  'github_workflow_update',
  'github_workflow_dispatch',
  'github_release_create',
] as const;

const metadata = (intent: GitIntent, writeClass: GitWriteClass, approval: GitApprovalRequirement, risk: GitRiskLevel, description: string, destructive = false): GitIntentMetadata => ({
  intent,
  writeClass,
  readOnly: writeClass === 'read_only',
  workspaceWrite: writeClass === 'workspace_write',
  localGitWrite: writeClass === 'local_git_write',
  remoteWrite: writeClass === 'remote_write',
  destructive,
  risk,
  approval,
  description,
});

export const GIT_INTENT_METADATA: Record<GitIntent, GitIntentMetadata> = {
  git_status_summary: metadata('git_status_summary', 'read_only', 'none', 'low', 'Summarize current repository status.'),
  git_diff_analysis: metadata('git_diff_analysis', 'read_only', 'none', 'low', 'Review or explain a bounded Git diff.'),
  git_commit_message: metadata('git_commit_message', 'read_only', 'none', 'low', 'Generate or review a commit message from staged changes.'),
  git_history_analysis: metadata('git_history_analysis', 'read_only', 'none', 'low', 'Inspect bounded commit history.'),
  git_blame_analysis: metadata('git_blame_analysis', 'read_only', 'none', 'low', 'Inspect bounded blame information for a file.'),
  git_branch_compare: metadata('git_branch_compare', 'read_only', 'none', 'low', 'Compare two branches without switching or merging.'),
  git_branch_create: metadata('git_branch_create', 'local_git_write', 'policy', 'medium', 'Create a local branch.'),
  git_branch_delete: metadata('git_branch_delete', 'local_git_write', 'explicit', 'high', 'Delete a local branch.', true),
  git_changelog_update: metadata('git_changelog_update', 'workspace_write', 'policy', 'medium', 'Update changelog or release notes files.'),
  git_commit: metadata('git_commit', 'local_git_write', 'explicit', 'high', 'Create a local Git commit.'),
  git_commit_amend: metadata('git_commit_amend', 'local_git_write', 'explicit', 'high', 'Amend the latest local commit.', true),
  git_merge: metadata('git_merge', 'local_git_write', 'explicit', 'high', 'Merge one branch into another locally.'),
  git_rebase: metadata('git_rebase', 'local_git_write', 'explicit', 'critical', 'Rewrite local branch history with rebase.', true),
  git_tag_create: metadata('git_tag_create', 'local_git_write', 'explicit', 'medium', 'Create a local annotated tag.'),
  git_release_prepare: metadata('git_release_prepare', 'workspace_write', 'policy', 'high', 'Prepare version and changelog changes for release.'),
  github_pr_draft: metadata('github_pr_draft', 'read_only', 'none', 'low', 'Draft a pull request title/body without creating it.'),
  github_pr_create: metadata('github_pr_create', 'remote_write', 'explicit', 'high', 'Create one GitHub pull request.'),
  github_pr_review: metadata('github_pr_review', 'read_only', 'none', 'medium', 'Review a pull request or PR diff.'),
  github_pr_comment: metadata('github_pr_comment', 'remote_write', 'explicit', 'high', 'Comment on a GitHub pull request.'),
  github_pr_merge: metadata('github_pr_merge', 'remote_write', 'always_explicit', 'critical', 'Merge a remote GitHub pull request.', true),
  github_issue_draft: metadata('github_issue_draft', 'read_only', 'none', 'low', 'Draft a GitHub issue without creating it.'),
  github_issue_create: metadata('github_issue_create', 'remote_write', 'explicit', 'high', 'Create one GitHub issue.'),
  github_issue_update: metadata('github_issue_update', 'remote_write', 'explicit', 'high', 'Update an existing GitHub issue.'),
  github_workflow_analyze: metadata('github_workflow_analyze', 'read_only', 'none', 'medium', 'Analyze GitHub Actions workflows or runs.'),
  github_workflow_update: metadata('github_workflow_update', 'workspace_write', 'policy', 'high', 'Patch GitHub Actions workflow files.'),
  github_workflow_dispatch: metadata('github_workflow_dispatch', 'remote_write', 'explicit', 'critical', 'Dispatch or rerun a GitHub Actions workflow.'),
  github_release_create: metadata('github_release_create', 'remote_write', 'always_explicit', 'critical', 'Publish a GitHub release.', true),
};

const intentMatchers: Array<{ intent: GitIntent; patterns: RegExp[]; confidence: number }> = [
  { intent: 'git_commit_message', confidence: 0.96, patterns: [/\b(generate|suggest|write|improve|review)\b[\s\S]{0,50}\bcommit message\b/i] },
  { intent: 'git_commit_amend', confidence: 0.95, patterns: [/\b(amend|fixup)\b[\s\S]{0,30}\bcommit\b/i] },
  { intent: 'git_commit', confidence: 0.93, patterns: [/\b(commit|create a commit)\b/i, /\bcommit (these|the|my|staged|current) changes\b/i] },
  { intent: 'git_changelog_update', confidence: 0.94, patterns: [/\b(update|create|write|maintain)\b[\s\S]{0,40}\b(change ?log|release notes)\b/i] },
  { intent: 'github_pr_create', confidence: 0.94, patterns: [/\b(create|open|publish)\b[\s\S]{0,40}\b(pull request|pr)\b/i] },
  { intent: 'github_pr_draft', confidence: 0.95, patterns: [/\b(draft|write|generate|prepare)\b[\s\S]{0,40}\b(pull request|pr)\b/i, /\bpr description\b/i] },
  { intent: 'github_pr_merge', confidence: 0.95, patterns: [/\bmerge\b[\s\S]{0,40}\b(pull request|pr)\b/i] },
  { intent: 'github_pr_review', confidence: 0.9, patterns: [/\b(review|analy[sz]e)\b[\s\S]{0,40}\b(pull request|pr)\b/i] },
  { intent: 'github_pr_comment', confidence: 0.9, patterns: [/\b(comment|reply)\b[\s\S]{0,40}\b(pull request|pr)\b/i] },
  { intent: 'github_issue_create', confidence: 0.94, patterns: [/\b(create|open|file|publish)\b[\s\S]{0,40}\b(issue|bug report)\b/i, /\bopen this issue on github\b/i] },
  { intent: 'github_issue_draft', confidence: 0.93, patterns: [/\b(draft|write|generate|prepare)\b[\s\S]{0,40}\b(issue|bug report)\b/i] },
  { intent: 'github_issue_update', confidence: 0.9, patterns: [/\b(update|edit|close|reopen)\b[\s\S]{0,40}\b(issue)\b/i] },
  { intent: 'github_workflow_dispatch', confidence: 0.95, patterns: [/\b(run|dispatch|rerun|trigger)\b[\s\S]{0,50}\b(workflow|github action|deployment)\b/i] },
  { intent: 'github_workflow_update', confidence: 0.92, patterns: [/\b(update|fix|patch|edit)\b[\s\S]{0,50}\b(workflow|github action|\.github\/workflows)\b/i] },
  { intent: 'github_workflow_analyze', confidence: 0.91, patterns: [/\b(analy[sz]e|why did|debug|inspect|review)\b[\s\S]{0,60}\b(workflow|github action|ci|build failed|deployment failed)\b/i] },
  { intent: 'github_release_create', confidence: 0.95, patterns: [/\b(create|publish)\b[\s\S]{0,40}\bgithub release\b/i] },
  { intent: 'git_release_prepare', confidence: 0.9, patterns: [/\b(prepare|stage|plan)\b[\s\S]{0,40}\brelease\b/i] },
  { intent: 'git_rebase', confidence: 0.95, patterns: [/\brebase\b/i] },
  { intent: 'git_merge', confidence: 0.93, patterns: [/\bmerge\b[\s\S]{0,40}\b(branch|into|from)\b/i] },
  { intent: 'git_tag_create', confidence: 0.92, patterns: [/\b(create|add)\b[\s\S]{0,30}\btag\b/i] },
  { intent: 'git_branch_delete', confidence: 0.93, patterns: [/\b(delete|remove)\b[\s\S]{0,30}\bbranch\b/i] },
  { intent: 'git_branch_create', confidence: 0.91, patterns: [/\b(create|new|make)\b[\s\S]{0,30}\bbranch\b/i] },
  { intent: 'git_branch_compare', confidence: 0.88, patterns: [/\b(compare)\b[\s\S]{0,40}\b(branch|branches)\b/i] },
  { intent: 'git_blame_analysis', confidence: 0.9, patterns: [/\b(blame|who changed|when was.*changed)\b/i] },
  { intent: 'git_history_analysis', confidence: 0.86, patterns: [/\b(history|log|last \d+ commits|recent commits|hotspots?)\b/i] },
  { intent: 'git_diff_analysis', confidence: 0.88, patterns: [/\b(diff|review my diff|review the changes|what changed)\b/i] },
  { intent: 'git_status_summary', confidence: 0.86, patterns: [/\b(git status|status summary|repo status|working tree)\b/i] },
];

export function classifyGitIntent(message: string, mode: string = 'agent'): GitIntentClassification {
  const text = message.trim();
  const matches = intentMatchers
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(text)))
    .map((entry) => ({ intent: entry.intent, confidence: adjustConfidence(entry.intent, entry.confidence, text, mode) }))
    .sort((a, b) => b.confidence - a.confidence);

  if (matches.length === 0) {
    return {
      primaryIntent: looksGitRelated(text) ? 'unknown_git' : 'unknown_git',
      secondaryIntents: [],
      confidence: looksGitRelated(text) ? 0.34 : 0,
      scope: inferScope(text),
      requiresWorkspaceWrite: false,
      requiresGitWrite: false,
      requiresRemoteWrite: false,
      requiresApproval: looksGitRelated(text),
    };
  }

  const primary = preferDraftOverCreateWhenExplicit(matches, text);
  const meta = GIT_INTENT_METADATA[primary.intent];
  const secondaryIntents = matches
    .filter((match) => match.intent !== primary.intent)
    .map((match) => match.intent)
    .slice(0, 3);

  return {
    primaryIntent: primary.intent,
    secondaryIntents,
    confidence: primary.confidence,
    scope: inferScope(text),
    requiresWorkspaceWrite: meta.workspaceWrite,
    requiresGitWrite: meta.localGitWrite,
    requiresRemoteWrite: meta.remoteWrite,
    requiresApproval: meta.approval !== 'none',
    metadata: meta,
  };
}

export function resolveGitRoute(message: string, mode: string = 'agent'): GitRouteResolution {
  const classification = classifyGitIntent(message, mode);
  const meta = classification.metadata;
  const route = meta ? routeForIntent(meta.intent) : 'general_agent';
  const selectedSkills = selectGitSkills(classification);
  const telemetry = buildGitIntentTelemetry(classification, route);
  return {
    isGitTask: Boolean(meta) || classification.confidence > 0,
    route,
    classification,
    risk: meta?.risk ?? 'low',
    requiredApproval: meta?.approval ?? 'none',
    allowedTools: route === 'general_agent' ? [] : toolsForGitRoute(route, classification.primaryIntent),
    selectedSkills,
    telemetry,
  };
}

export function routeForIntent(intent: GitIntent): GitRoute {
  if (intent === 'git_commit_message') return 'git_commit_message';
  if (intent === 'git_history_analysis' || intent === 'git_blame_analysis') return 'git_history';
  if (intent === 'git_changelog_update') return 'git_workspace_edit';
  if (intent.startsWith('github_workflow_')) return 'github_actions';
  if (intent === 'git_release_prepare' || intent === 'github_release_create') return 'release_management';
  if (GIT_INTENT_METADATA[intent].remoteWrite || intent.startsWith('github_')) return 'github_remote_write';
  if (GIT_INTENT_METADATA[intent].localGitWrite) return 'git_local_write';
  return 'git_read';
}

export function toolsForGitRoute(route: GitRoute, intent: GitIntent | 'unknown_git'): string[] {
  const commonRead = ['git_status', 'git_diff'];
  const routeTools: Record<GitRoute, string[]> = {
    git_read: [...commonRead, 'git_log', 'git_show', 'git_blame', 'git_compare_branches', 'git_tag_list'],
    git_commit_message: ['git_status', 'git_diff', 'git_log'],
    git_history: ['git_log', 'git_show', 'git_blame', 'git_tag_list'],
    git_workspace_edit: [...commonRead, 'git_log', 'detect_changelog_strategy', 'aggregate_changelog', 'generate_changelog_patch'],
    git_local_write: [...commonRead, 'git_stage_files', 'git_unstage_files', 'git_commit', 'git_branch_create', 'git_branch_switch', 'git_branch_delete', 'git_merge', 'git_rebase', 'git_tag_create', 'git_tag_delete_local'],
    github_remote_write: ['git_status', 'git_compare_branches', 'github_verify_repository', 'github_draft_pull_request', 'github_create_pull_request', 'github_draft_issue', 'github_create_issue', 'github_find_duplicate_issues'],
    github_actions: ['discover_github_workflows', 'analyze_github_workflow', 'github_get_workflow_run', 'github_dispatch_workflow'],
    release_management: [...commonRead, 'detect_changelog_strategy', 'aggregate_changelog', 'generate_changelog_patch', 'release_plan_controller', 'git_commit', 'git_tag_create', 'github_create_release'],
  };
  const tools = routeTools[route];
  if (intent === 'github_pr_draft') return tools.filter((tool) => tool !== 'github_create_pull_request');
  if (intent === 'github_issue_draft') return tools.filter((tool) => tool !== 'github_create_issue');
  if (intent === 'github_workflow_analyze') return tools.filter((tool) => tool !== 'github_dispatch_workflow');
  return tools;
}

export function approvalForGitOperation(operation: GitIntent | 'git_push' | 'git_force_push' | 'production_deployment'): GitApprovalRequirement {
  if (operation === 'git_force_push' || operation === 'production_deployment') return 'always_explicit';
  if (operation === 'git_push') return 'explicit';
  return GIT_INTENT_METADATA[operation].approval;
}

export function selectGitSkills(classification: GitIntentClassification): GitSkillSelection {
  const intent = classification.primaryIntent;
  const mapping: Partial<Record<GitIntent, string>> = {
    git_commit_message: 'git-commit-message',
    git_status_summary: 'git-read',
    git_diff_analysis: 'git-read',
    git_branch_compare: 'git-read',
    git_history_analysis: 'git-history-analysis',
    git_blame_analysis: 'git-history-analysis',
    git_commit: 'git-commit',
    git_commit_amend: 'git-commit',
    git_changelog_update: 'changelog-maintenance',
    github_pr_draft: 'github-pull-request',
    github_pr_create: 'github-pull-request',
    github_pr_review: 'github-pull-request',
    github_issue_draft: 'github-issues',
    github_issue_create: 'github-issues',
    github_issue_update: 'github-issues',
    github_workflow_analyze: 'github-actions',
    github_workflow_update: 'github-actions',
    github_workflow_dispatch: 'github-actions',
    git_release_prepare: 'release-management',
    github_release_create: 'release-management',
  };
  const primarySkill = intent === 'unknown_git' ? undefined : mapping[intent];
  const secondarySkills = classification.secondaryIntents
    .map((secondary) => mapping[secondary])
    .filter((skill): skill is string => Boolean(skill) && skill !== primarySkill)
    .slice(0, 2);
  const candidates = [primarySkill, ...secondarySkills]
    .filter((skill): skill is string => Boolean(skill))
    .map((skill, index) => ({
      skill,
      score: index === 0 ? classification.confidence : Math.max(0.4, classification.confidence - 0.2 - index / 10),
      reason: index === 0 ? 'primary Git intent match' : 'secondary Git intent match',
    }));
  const all = ['git-workflow-guidance', 'git-commit-message', 'git-read', 'git-history-analysis', 'git-commit', 'changelog-maintenance', 'github-pull-request', 'github-issues', 'github-actions', 'release-management'];
  const selected = new Set(candidates.map((candidate) => candidate.skill));
  return {
    primarySkill,
    additionalSkills: secondarySkills,
    candidates,
    rejected: all.filter((skill) => !selected.has(skill)).map((skill) => ({ skill, reason: 'not selected for this Git intent' })),
    injected: candidates.map((candidate) => candidate.skill),
  };
}

export interface CompositeGitStage {
  id: string;
  intent: GitIntent;
  route: GitRoute;
  approval: GitApprovalRequirement;
  allowedTools: string[];
}

export function decomposeCompositeGitTask(message: string): CompositeGitStage[] {
  const lower = message.toLowerCase();
  const stages: GitIntent[] = [];
  const push = (intent: GitIntent) => {
    if (!stages.includes(intent)) stages.push(intent);
  };
  if (/\bchange ?log|release notes\b/.test(lower)) push('git_changelog_update');
  if (/\bcommit\b/.test(lower)) push('git_commit');
  if (/\bpush\b/.test(lower)) push('github_pr_create');
  if (/\b(create|open|draft)\b[\s\S]{0,30}\b(pr|pull request)\b/.test(lower)) push(/\bdraft\b/.test(lower) ? 'github_pr_draft' : 'github_pr_create');
  if (/\b(issue)\b/.test(lower)) push(/\bdraft|write|generate\b/.test(lower) ? 'github_issue_draft' : 'github_issue_create');
  if (/\btag\b/.test(lower)) push('git_tag_create');
  if (/\brelease\b/.test(lower)) push('git_release_prepare');

  return stages.map((intent, index) => {
    const route = routeForIntent(intent);
    return {
      id: `${index + 1}-${intent}`,
      intent,
      route,
      approval: GIT_INTENT_METADATA[intent].approval,
      allowedTools: toolsForGitRoute(route, intent),
    };
  });
}

export const GIT_TOOL_BUDGETS: Record<string, { maxLlmCalls: number; maxToolCalls: number; maxInputTokens?: number }> = {
  git_commit_message: { maxLlmCalls: 1, maxToolCalls: 3, maxInputTokens: 12_000 },
  git_history_analysis: { maxLlmCalls: 2, maxToolCalls: 4, maxInputTokens: 20_000 },
  git_commit: { maxLlmCalls: 2, maxToolCalls: 6 },
  github_pr_create: { maxLlmCalls: 3, maxToolCalls: 8 },
};

export function canonicalGitActionSignature(kind: string, parts: Record<string, unknown>): string {
  const stable = Object.keys(parts)
    .sort()
    .map((key) => `${key}:${JSON.stringify(parts[key] ?? '')}`)
    .join('|');
  return `${kind}:${sha256(stable).slice(0, 20)}`;
}

export class GitNoProgressTracker {
  private signatures = new Map<string, number>();

  record(signature: string): { repeated: boolean; count: number; shouldStop: boolean } {
    const count = (this.signatures.get(signature) ?? 0) + 1;
    this.signatures.set(signature, count);
    return { repeated: count > 1, count, shouldStop: count >= 3 };
  }

  reset(): void {
    this.signatures.clear();
  }
}

export function buildGitIntentTelemetry(
  classification: GitIntentClassification,
  route: GitRoute | 'general_agent'
): GitIntentTelemetry {
  const meta = classification.metadata;
  return {
    detectedIntent: meta?.intent ?? 'unknown_git',
    confidence: classification.confidence,
    scope: classification.scope,
    route,
    risk: meta?.risk ?? 'low',
    writeClass: meta?.writeClass ?? 'unknown',
    approval: meta?.approval ?? 'none',
  };
}

function adjustConfidence(intent: GitIntent, base: number, text: string, mode: string): number {
  let confidence = base;
  if (mode === 'ask' && GIT_INTENT_METADATA[intent].readOnly) confidence += 0.02;
  if (/\b(draft|write|generate|suggest|prepare)\b/i.test(text) && GIT_INTENT_METADATA[intent].remoteWrite) confidence -= 0.1;
  if (/\b(create|open|publish|run|dispatch|merge|commit|delete)\b/i.test(text) && !GIT_INTENT_METADATA[intent].readOnly) confidence += 0.02;
  return Math.max(0, Math.min(1, confidence));
}

function preferDraftOverCreateWhenExplicit(
  matches: Array<{ intent: GitIntent; confidence: number }>,
  text: string
): { intent: GitIntent; confidence: number } {
  if (/\bdraft|write|generate|suggest|prepare\b/i.test(text) && !/\b(create|open|publish|submit)\b/i.test(text)) {
    const draft = matches.find((match) => match.intent === 'github_pr_draft' || match.intent === 'github_issue_draft' || match.intent === 'git_commit_message');
    if (draft) return { ...draft, confidence: Math.max(draft.confidence, 0.93) };
  }
  return matches[0];
}

function looksGitRelated(text: string): boolean {
  return /\b(git|github|commit|branch|diff|pr|pull request|issue|workflow|release|tag|rebase|merge|changelog)\b/i.test(text);
}

function inferScope(text: string): string {
  const pathMatches = Array.from(text.matchAll(/(?:^|\s)([\w./-]+\.(?:tsx?|jsx?|json|ya?ml|md|mdx|lock|toml|rs|go|py|sh))\b/g))
    .map((match) => match[1])
    .slice(0, 6);
  if (pathMatches.length > 0) return pathMatches.join(',');
  const branchMatch = text.match(/\b(?:branch|from|into|base|head)\s+([A-Za-z0-9._/-]+)/i);
  return branchMatch?.[1] ?? 'repository';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
