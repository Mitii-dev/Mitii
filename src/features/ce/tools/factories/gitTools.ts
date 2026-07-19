import type { ToolContribution, ToolFactoryContribution } from '../../../../interfaces/tools';
import { toToolContribution } from '../../../../kernel/tools';
import {
  createGitStatusTool,
  createStructuredGitDiffTool,
  createGitLogTool,
  createGitShowTool,
  createGitBlameTool,
  createGitCompareBranchesTool,
  createGitStageFilesTool,
  createGitUnstageFilesTool,
  createGitCommitTool,
  createGitBranchCreateTool,
  createGitBranchSwitchTool,
  createGitBranchDeleteTool,
  createGitMergeTool,
  createGitRebaseTool,
  createGitTagTools,
  createChangelogTools,
  createWorkflowTools,
  createGitHubTools,
  createReleasePlanControllerTool,
} from '../../git/tools/gitTools';
import type { CeSessionServices } from '../sessionServices';
import { makeToolFactory } from './toolFactoryHelper';

const OWNER = 'ce.tools.git';
const factory = makeToolFactory(OWNER);

/**
 * `createGitTagTools`/`createChangelogTools`/`createWorkflowTools`/`createGitHubTools` each
 * return several tools (with fixed, workspace-independent names) from one call. Wrap the group,
 * then pick out one tool by its already-known static name so each still registers as its own
 * `ToolFactoryContribution` — same shape as every other tool.
 */
function fromGroup(
  id: string,
  create: (services: CeSessionServices) => ReturnType<typeof createGitTagTools>
): ToolFactoryContribution<unknown, CeSessionServices> {
  return {
    id,
    owner: OWNER,
    create: (services: CeSessionServices): ToolContribution => {
      const tool = create(services).find((t) => t.name === id);
      if (!tool) throw new Error(`Tool group did not produce expected tool "${id}"`);
      return toToolContribution(tool, OWNER);
    },
  };
}

/**
 * Real `ToolFactoryContribution`s for the git-tools feature — wraps the existing tool factories,
 * doesn't reimplement them.
 *
 * Note: `createGitDiffTool` (simple `git diff`) and `createStructuredGitDiffTool` (rich,
 * bounded/redacted diff) both produce a tool named `git_diff`. In current production,
 * `ThunderController` registers both in that order and `ToolRuntime.register()` silently
 * overwrites on duplicate names — so `createStructuredGitDiffTool`'s version is the only one that
 * is ever actually reachable; `createGitDiffTool` (and the `GitService` it needs) is dead code
 * today. This registry throws on duplicate ids rather than silently overwriting, so only the tool
 * that's actually live in production is registered here.
 */
export const gitToolFactories: readonly ToolFactoryContribution<unknown, CeSessionServices>[] = [
  factory('git_status', (s) => toToolContribution(createGitStatusTool(s.workspace), OWNER)),
  factory('git_diff', (s) => toToolContribution(createStructuredGitDiffTool(s.workspace), OWNER)),
  factory('git_log', (s) => toToolContribution(createGitLogTool(s.workspace), OWNER)),
  factory('git_show', (s) => toToolContribution(createGitShowTool(s.workspace), OWNER)),
  factory('git_blame', (s) => toToolContribution(createGitBlameTool(s.workspace), OWNER)),
  factory('git_compare_branches', (s) => toToolContribution(createGitCompareBranchesTool(s.workspace), OWNER)),
  factory('git_stage_files', (s) => toToolContribution(createGitStageFilesTool(s.workspace), OWNER)),
  factory('git_unstage_files', (s) => toToolContribution(createGitUnstageFilesTool(s.workspace), OWNER)),
  factory('git_commit', (s) => toToolContribution(createGitCommitTool(s.workspace), OWNER)),
  factory('git_branch_create', (s) => toToolContribution(createGitBranchCreateTool(s.workspace), OWNER)),
  factory('git_branch_switch', (s) => toToolContribution(createGitBranchSwitchTool(s.workspace), OWNER)),
  factory('git_branch_delete', (s) => toToolContribution(createGitBranchDeleteTool(s.workspace), OWNER)),
  factory('git_merge', (s) => toToolContribution(createGitMergeTool(s.workspace), OWNER)),
  factory('git_rebase', (s) => toToolContribution(createGitRebaseTool(s.workspace), OWNER)),
  factory('release_plan_controller', () => toToolContribution(createReleasePlanControllerTool(), OWNER)),

  fromGroup('git_tag_list', (s) => createGitTagTools(s.workspace)),
  fromGroup('git_tag_create', (s) => createGitTagTools(s.workspace)),
  fromGroup('git_tag_delete_local', (s) => createGitTagTools(s.workspace)),

  fromGroup('detect_changelog_strategy', (s) => createChangelogTools(s.workspace)),
  fromGroup('aggregate_changelog', (s) => createChangelogTools(s.workspace)),
  fromGroup('generate_changelog_patch', (s) => createChangelogTools(s.workspace)),

  fromGroup('discover_github_workflows', (s) => createWorkflowTools(s.workspace)),
  fromGroup('analyze_github_workflow', (s) => createWorkflowTools(s.workspace)),
  fromGroup('github_dispatch_workflow', (s) => createWorkflowTools(s.workspace)),
  fromGroup('github_get_workflow_run', (s) => createWorkflowTools(s.workspace)),

  fromGroup('github_verify_repository', (s) => createGitHubTools(s.workspace)),
  fromGroup('github_draft_pull_request', (s) => createGitHubTools(s.workspace)),
  fromGroup('github_create_pull_request', (s) => createGitHubTools(s.workspace)),
  fromGroup('github_draft_issue', (s) => createGitHubTools(s.workspace)),
  fromGroup('github_find_duplicate_issues', (s) => createGitHubTools(s.workspace)),
  fromGroup('github_create_issue', (s) => createGitHubTools(s.workspace)),
  fromGroup('github_create_release', (s) => createGitHubTools(s.workspace)),
];
