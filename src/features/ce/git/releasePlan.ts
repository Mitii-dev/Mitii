import type { GitApprovalRequirement } from './intents';

export type ReleaseStage =
  | 'inspect'
  | 'version_update'
  | 'changelog_update'
  | 'validate'
  | 'commit'
  | 'tag'
  | 'push'
  | 'github_release'
  | 'complete';

export interface ReleasePlanStageState {
  stage: ReleaseStage;
  allowedTools: string[];
  approval: GitApprovalRequirement;
  completed: boolean;
  result?: string;
}

export interface ReleasePlanState {
  currentStage: ReleaseStage;
  stages: ReleasePlanStageState[];
}

const RELEASE_STAGES: ReleasePlanStageState[] = [
  { stage: 'inspect', allowedTools: ['git_status', 'git_log', 'detect_changelog_strategy'], approval: 'none', completed: false },
  { stage: 'version_update', allowedTools: ['read_file', 'write_file', 'apply_patch'], approval: 'policy', completed: false },
  { stage: 'changelog_update', allowedTools: ['aggregate_changelog', 'generate_changelog_patch', 'apply_patch'], approval: 'policy', completed: false },
  { stage: 'validate', allowedTools: ['run_command'], approval: 'policy', completed: false },
  { stage: 'commit', allowedTools: ['git_status', 'git_diff', 'git_commit'], approval: 'explicit', completed: false },
  { stage: 'tag', allowedTools: ['git_tag_create'], approval: 'explicit', completed: false },
  { stage: 'push', allowedTools: ['git_push'], approval: 'explicit', completed: false },
  { stage: 'github_release', allowedTools: ['github_create_release'], approval: 'always_explicit', completed: false },
  { stage: 'complete', allowedTools: [], approval: 'none', completed: false },
];

export function createReleasePlanState(): ReleasePlanState {
  return { currentStage: 'inspect', stages: RELEASE_STAGES.map((stage) => ({ ...stage })) };
}

export function completeReleaseStage(state: ReleasePlanState, stage: ReleaseStage, result: string): ReleasePlanState {
  const stages = state.stages.map((item) => item.stage === stage ? { ...item, completed: true, result } : item);
  const currentIndex = stages.findIndex((item) => item.stage === stage);
  const next = stages[currentIndex + 1]?.stage ?? 'complete';
  return { currentStage: next, stages };
}

export function getCurrentReleaseStage(state: ReleasePlanState): ReleasePlanStageState {
  return state.stages.find((stage) => stage.stage === state.currentStage) ?? state.stages[0];
}
