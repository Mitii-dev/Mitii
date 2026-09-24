/**
 * Built-in automation templates (enterprise starter pack).
 * Mirrors docs/automation/cron examples — copied into .mitii/cron on apply.
 */

import { createEmptyFlow, type AutomationFlowDocument } from './flow.js';

export interface AutomationTemplate {
  id: string;
  title: string;
  description: string;
  category: 'schedule' | 'git' | 'ci' | 'ops';
  build: () => AutomationFlowDocument;
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'morning-health',
    title: 'Morning health',
    description: 'Weekday cron — readonly repo health summary.',
    category: 'schedule',
    build: () => {
      const flow = createEmptyFlow({
        id: 'morning-health',
        title: 'Morning health',
      });
      flow.trigger = {
        kind: 'schedule',
        cron: '0 9 * * MON-FRI',
        timezone: 'America/Chicago',
      };
      flow.agent = {
        mode: 'ask',
        autonomyPreset: 'readonly',
        prompt: [
          'Summarize repository health for this workspace:',
          '',
          '1. List dirty git status briefly',
          '2. Note any failing tests if a standard test script is obvious',
          '3. Reply with a short markdown report only — do not edit files',
        ].join('\n'),
        mapping: {},
      };
      return flow;
    },
  },
  {
    id: 'post-commit-cover',
    title: 'Post-commit cover',
    description: 'On github.push — write missing tests and open a draft PR.',
    category: 'git',
    build: () => {
      const flow = createEmptyFlow({
        id: 'post-commit-cover',
        title: 'Post-commit cover',
      });
      flow.trigger = {
        kind: 'event',
        eventType: 'github.push',
        dedupeWindowSeconds: 600,
        cooldownSeconds: 120,
      };
      flow.agent = {
        mode: 'agent',
        autonomyPreset: 'apply_and_pr',
        agentId: 'post-commit-cover',
        maxParallel: 1,
        prompt: [
          'A push just landed. Inspect the pushed commits, write missing tests for changed',
          'behavior, run the focused suite then the repo suite, and if green open a draft',
          'PR via `create_pull_request` from branch `mitii/cover-<shortsha>`.',
          'Never push to main or master.',
          '',
          'Repository: {{repository}}',
          'Ref: {{ref}}',
          'SHA: {{sha}}',
        ].join('\n'),
        mapping: {
          repository: 'repository',
          ref: 'ref',
          sha: 'after',
        },
      };
      return flow;
    },
  },
  {
    id: 'ci-failure-triage',
    title: 'CI failure triage',
    description: 'On failed workflow_run — fingerprint issue + optional fix PR.',
    category: 'ci',
    build: () => {
      const flow = createEmptyFlow({
        id: 'ci-failure-triage',
        title: 'CI Failure Triage',
      });
      flow.trigger = {
        kind: 'event',
        eventType: 'github.workflow_run.completed',
        filters: { conclusion: 'failure' },
        dedupeWindowSeconds: 3600,
        cooldownSeconds: 300,
      };
      flow.agent = {
        mode: 'agent',
        autonomyPreset: 'apply',
        agentId: 'incident-from-logs',
        maxParallel: 1,
        prompt: [
          'Triage this CI workflow failure.',
          '',
          '1. Use the Suggested ticket fingerprint from the trigger context when present.',
          '2. Read the payload / evidence pack; identify the failing job.',
          '3. Open or update a GitHub issue with `create_github_issue` and that `fingerprint`',
          '   (idempotent: comments on an existing `[mitii:<fingerprint>]` issue).',
          '4. If a fix is verified, put it on a feature branch and optionally',
          '   `create_pull_request` as a draft. Never push to main.',
        ].join('\n'),
        mapping: {
          workflow: 'workflow.name',
          conclusion: 'conclusion',
        },
      };
      return flow;
    },
  },
  {
    id: 'local-commit-review',
    title: 'Local commit review',
    description: 'On git.commit.local — ask-mode review of the latest commit.',
    category: 'git',
    build: () => {
      const flow = createEmptyFlow({
        id: 'local-commit-review',
        title: 'Local commit review',
      });
      flow.trigger = {
        kind: 'event',
        eventType: 'git.commit.local',
        cooldownSeconds: 30,
      };
      flow.agent = {
        mode: 'ask',
        autonomyPreset: 'readonly',
        prompt: [
          'Review the latest local commit (message + diff).',
          '',
          'Commit: {{message}}',
          'SHA: {{sha}}',
          '',
          'List risks, missing tests, and suggested follow-ups. Do not edit files.',
        ].join('\n'),
        mapping: {
          message: 'message',
          sha: 'sha',
        },
      };
      flow.steps = [
        {
          id: 'step_review_local',
          kind: 'review',
          label: 'Prepare review context',
        },
      ];
      flow.layout.steps = {
        step_review_local: { x: 240, y: 140 },
      };
      return flow;
    },
  },
];

export function getAutomationTemplate(
  id: string,
): AutomationTemplate | undefined {
  return AUTOMATION_TEMPLATES.find((t) => t.id === id);
}
