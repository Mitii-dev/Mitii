import { describe, expect, it } from 'vitest';
import { SkillCatalogContextSource, SkillCatalogService } from '../src/core/skills/SkillCatalogService';
import {
  loadPlanningSkillPlaybooks,
  resolvePlanningSkillNames,
} from '../src/core/modes/plan/planSkillRouting';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('planSkillRouting', () => {
  it('resolves planning-and-task-breakdown for feature plans', () => {
    const names = resolvePlanningSkillNames('feature', {
      kind: 'implementation',
      complexity: 'high',
      summary: 'Build SDK',
      shouldPlan: true,
      shouldVerify: true,
      shouldUseSubagents: false,
    });
    expect(names).toEqual(['planning-and-task-breakdown']);
    expect(names).not.toContain('using-agent-skills');
    expect(names).not.toContain('agent-plan');
  });

  it('resolves agent-plan for Agent-mode structured planning', () => {
    const names = resolvePlanningSkillNames('feature', {
      kind: 'implementation',
      complexity: 'high',
      summary: 'Build SDK',
      shouldPlan: true,
      shouldVerify: true,
      shouldUseSubagents: false,
    }, { sourceMode: 'agent' });

    expect(names).toEqual(['agent-plan']);
  });

  it('injects Git route selected skills into planning', () => {
    const names = resolvePlanningSkillNames('feature', {
      kind: 'implementation',
      complexity: 'low',
      summary: 'Create a pull request',
      shouldPlan: true,
      shouldVerify: true,
      shouldUseSubagents: false,
      gitRoute: {
        isGitTask: true,
        route: 'github_remote_write',
        classification: {
          primaryIntent: 'github_pr_create',
          secondaryIntents: [],
          confidence: 0.94,
          scope: 'repo',
          requiresWorkspaceWrite: false,
          requiresGitWrite: false,
          requiresRemoteWrite: true,
          requiresApproval: true,
        },
        risk: 'high',
        requiredApproval: 'explicit',
        allowedTools: [],
        selectedSkills: {
          primarySkill: 'github-pull-request',
          additionalSkills: [],
          candidates: [{ skill: 'github-pull-request', score: 0.94, reason: 'primary' }],
          rejected: [],
          injected: ['github-pull-request'],
        },
        telemetry: {
          detectedIntent: 'github_pr_create',
          confidence: 0.94,
          scope: 'repo',
          route: 'github_remote_write',
          risk: 'high',
          writeClass: 'remote_write',
          approval: 'explicit',
        },
      },
    });
    expect(names).toEqual(['github-pull-request']);
    expect(names).not.toContain('using-agent-skills');
  });

  it('loads skill playbooks from workspace catalog', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mitii-plan-skills-'));
    try {
      const skillDir = join(workspace, '.mitii', 'skills', 'planning-and-task-breakdown');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: planning-and-task-breakdown
description: Breaks work into ordered tasks.
---

# Planning and Task Breakdown
`,
        'utf8'
      );

      const catalog = new SkillCatalogService(workspace);
      catalog.refresh();
      const { context, loaded } = loadPlanningSkillPlaybooks(catalog, ['planning-and-task-breakdown']);
      expect(loaded).toContain('planning-and-task-breakdown');
      expect(context).toContain('Planning skill playbooks');
      expect(context).toContain('Planning and Task Breakdown');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('loads quick references without full skill bodies', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mitii-plan-skills-quick-ref-'));
    try {
      const skillDir = join(workspace, '.mitii', 'skills', 'planning-and-task-breakdown');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: planning-and-task-breakdown
description: Breaks work into ordered tasks.
---

# Planning and Task Breakdown

## Quick Reference

- Decompose work into phases.

## Full Procedure

This full procedure should stay out of quick-ref prompts.
`,
        'utf8'
      );

      const catalog = new SkillCatalogService(workspace);
      catalog.refresh();
      const { context, loaded } = loadPlanningSkillPlaybooks(
        catalog,
        ['planning-and-task-breakdown'],
        { style: 'quick-ref', maxChars: 1000 }
      );
      expect(loaded).toEqual(['planning-and-task-breakdown']);
      expect(context).toContain('Description: Breaks work into ordered tasks.');
      expect(context).toContain('## Quick Reference');
      expect(context).not.toContain('Full Procedure');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('strips frontmatter from quick-ref fallback text', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mitii-plan-skills-frontmatter-'));
    try {
      const skillDir = join(workspace, '.mitii', 'skills', 'no-heading-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: no-heading-skill
description: Has no quick reference heading.
---

Plain fallback body.
`,
        'utf8'
      );

      const catalog = new SkillCatalogService(workspace);
      catalog.refresh();
      const { context } = loadPlanningSkillPlaybooks(
        catalog,
        ['no-heading-skill'],
        { style: 'quick-ref', maxChars: 1000 }
      );
      expect(context).toContain('Plain fallback body.');
      expect(context).not.toContain('name: no-heading-skill');
      expect(context).not.toContain('---');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('suppresses the skill catalog context when tier policy uses none', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mitii-plan-skills-none-'));
    try {
      const skillDir = join(workspace, '.mitii', 'skills', 'planning-and-task-breakdown');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: planning-and-task-breakdown
description: Breaks work into ordered tasks.
---

# Planning
`,
        'utf8'
      );

      const catalog = new SkillCatalogService(workspace);
      catalog.refresh();
      const source = new SkillCatalogContextSource(catalog);
      await expect(source.retrieve({
        text: 'plan',
        tierPolicy: {
          skillInjection: 'none',
          maxSkillChars: 0,
          rulesMaxTotalChars: 6_000,
          rulesMaxCharsPerFile: 2_000,
        },
      })).resolves.toEqual([]);
      await expect(source.retrieve({
        text: 'plan',
        tierPolicy: {
          skillInjection: 'catalog',
          maxSkillChars: 0,
          rulesMaxTotalChars: 6_000,
          rulesMaxCharsPerFile: 2_000,
        },
      })).resolves.toHaveLength(1);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
