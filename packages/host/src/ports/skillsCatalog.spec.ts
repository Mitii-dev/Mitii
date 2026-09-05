import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SkillsPipeline, SKILLS_SCHEMA_VERSION } from '@mitii/v8';

import {
  createFileSystemSkillsCatalog,
  loadDiskSkillBody,
  loadDiskSkills,
} from './skillsCatalog.js';

describe('file system skills catalog', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mitii-skills-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('loads uploaded workspace SKILL.md files as compact metadata by default', async () => {
    const skillDir = join(root, '.mitii', 'skills', 'null-crash-debugging');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: null-crash-debugging
title: Null Crash Debugging
description: Find and fix nullable-value crashes with a small regression test.
intents: [bugfix, diagnose]
routes: [execute, diagnose]
tags: [null, crash, test]
paths: [apps/vscode/**, packages/v8/**]
priority: 150
conflictGroup: debugging
when: [The user reports a null crash, A regression test is needed]
instruction: Keep the patch localized and verify the failing path.
---

# Long internal playbook

This body can grow later with examples, references, and detailed checklists.
It is intentionally not injected in metadata mode.
`,
      'utf8',
    );

    const skills = await loadDiskSkills({
      workspaceRoot: root,
      includeBundled: false,
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'null-crash-debugging',
      title: 'Null Crash Debugging',
      intents: ['bugfix', 'diagnose'],
      routes: ['execute', 'diagnose'],
      tags: ['null', 'crash', 'test'],
      paths: ['apps/vscode/**', 'packages/v8/**'],
      priority: 150,
      conflictGroup: 'debugging',
      alwaysApply: false,
    });
    expect(skills[0]?.content).toContain(
      'Description: Find and fix nullable-value crashes',
    );
    expect(skills[0]?.content).not.toContain('Long internal playbook');
  });

  it('parses sizeClass and requireTagEvidence from frontmatter', async () => {
    const skillDir = join(root, '.mitii', 'skills', 'cicd-gated');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: cicd-gated
description: CI gated skill.
intents: [test]
routes: [execute]
tags: [ci, workflow]
sizeClass: M
requireTagEvidence: true
priority: 180
---

# Body
`,
      'utf8',
    );

    const skills = await loadDiskSkills({
      workspaceRoot: root,
      includeBundled: false,
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'cicd-gated',
      sizeClass: 'M',
      requireTagEvidence: true,
    });
  });

  it('loads agentskills.io minimal skills and hydrates the body lazily', async () => {
    const skillDir = join(root, '.mitii', 'skills', 'empty-input-parser');
    await mkdir(join(skillDir, 'references'), { recursive: true });
    await mkdir(join(skillDir, 'scripts'), { recursive: true });
    await writeFile(join(skillDir, 'references', 'cases.md'), 'Cases', 'utf8');
    await writeFile(join(skillDir, 'scripts', 'repro.ts'), 'console.log(1);', 'utf8');
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: Empty Input Parser
description: Fix empty input parser crashes in TypeScript files.
license: MIT
compatibility: [agentskills.io]
allowed-tools: [bash]
---

# Full agentskills playbook

Reproduce the empty-input parser crash, add the smallest guard, and test it.
`,
      'utf8',
    );

    const skills = await loadDiskSkills({
      workspaceRoot: root,
      includeBundled: false,
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'empty-input-parser',
      title: 'Empty Input Parser',
      description: 'Fix empty input parser crashes in TypeScript files.',
      intents: [],
      routes: [],
      tags: [],
    });
    expect(skills[0]?.content).toContain('Description:');
    expect(skills[0]?.content).not.toContain('allowed-tools');

    const body = await loadDiskSkillBody('empty-input-parser', {
      workspaceRoot: root,
      includeBundled: false,
    });
    expect(body?.content).toContain('Full agentskills playbook');
    expect(body?.resources).toEqual({
      references: ['references/cases.md'],
      scripts: ['scripts/repro.ts'],
    });
  });

  it('extracts compact planning blocks without injecting the whole skill body', async () => {
    const skillDir = join(root, '.mitii', 'skills', 'planning-default');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: planning-default
description: Plan work with Discover, Change, and Verify phases.
intents: [feature, bugfix]
routes: [plan, execute]
tags: [plan]
priority: 180
---

# Agent Discovery

Discover:
- Locate current behavior
- Collect evidence

Change:
- Implement smallest coherent change

Verify:
- Run lint/typecheck/tests

# Long Playbook

This long body should not be injected in metadata mode.
`,
      'utf8',
    );

    const skills = await loadDiskSkills({
      workspaceRoot: root,
      includeBundled: false,
    });

    expect(skills[0]?.content).toContain('Planning:');
    expect(skills[0]?.content).toContain('Discover:');
    expect(skills[0]?.content).toContain('- Locate current behavior');
    expect(skills[0]?.content).not.toContain('Long Playbook');
    expect(skills[0]?.content).not.toContain('This long body');
  });

  it('selects a matching uploaded skill without injecting the whole catalog', async () => {
    await writeSkill(root, 'null-crash-debugging', {
      description: 'Find and fix nullable-value crashes.',
      intents: ['bugfix'],
      routes: ['execute'],
      tags: ['null', 'crash'],
      priority: 150,
    });
    await writeSkill(root, 'docs-writing', {
      description: 'Write concise documentation updates.',
      intents: ['docs'],
      routes: ['execute', 'repository_answer'],
      tags: ['docs'],
      priority: 120,
    });

    const pipeline = new SkillsPipeline({
      catalog: createFileSystemSkillsCatalog({
        workspaceRoot: root,
        includeDefaults: false,
        includeBundled: false,
      }),
    });

    const result = await pipeline.select({
      schemaVersion: SKILLS_SCHEMA_VERSION,
      query: 'Fix the null crash in UserProfile and add a test',
      mode: 'agent',
      route: 'execute',
      evidence: {
        primaryIntent: 'bugfix',
        secondaryIntents: ['test'],
      },
    });

    expect(result.status).toBe('selected');
    expect(result.instructions.map((skill) => skill.id)).toEqual([
      'null-crash-debugging',
    ]);
    expect(result.instructions[0]?.content).toContain(
      'Full body for null-crash-debugging.',
    );
    expect(result.instructions[0]?.content).not.toContain('docs-writing');
  });

  it('passes path-gated uploaded skills only when evidence paths match', async () => {
    await writeSkill(root, 'vscode-sidebar-bugfix', {
      description: 'Fix VS Code sidebar bugs.',
      intents: ['bugfix'],
      routes: ['execute'],
      tags: ['sidebar'],
      paths: ['apps/vscode/**'],
      priority: 150,
    });
    await writeSkill(root, 'cli-output-bugfix', {
      description: 'Fix CLI output bugs.',
      intents: ['bugfix'],
      routes: ['execute'],
      tags: ['cli'],
      paths: ['apps/cli/**'],
      priority: 140,
    });

    const pipeline = new SkillsPipeline({
      catalog: createFileSystemSkillsCatalog({
        workspaceRoot: root,
        includeDefaults: false,
        includeBundled: false,
      }),
    });

    const result = await pipeline.select({
      schemaVersion: SKILLS_SCHEMA_VERSION,
      query: 'Fix the sidebar crash',
      mode: 'agent',
      route: 'execute',
      evidence: {
        primaryIntent: 'bugfix',
        secondaryIntents: [],
        paths: ['apps/vscode/src/sidebar.ts'],
      },
    });

    expect(result.status).toBe('selected');
    expect(result.instructions.map((skill) => skill.id)).toEqual([
      'vscode-sidebar-bugfix',
    ]);
  });

  it('skips uploaded skills marked enabled false', async () => {
    const disabledDir = join(root, '.mitii', 'skills', 'disabled-skill');
    await mkdir(disabledDir, { recursive: true });
    await writeFile(
      join(disabledDir, 'SKILL.md'),
      `---
name: disabled-skill
description: This skill should stay on disk but not load.
intents: [bugfix]
enabled: false
---

Full body.
`,
      'utf8',
    );

    await writeSkill(root, 'enabled-skill', {
      description: 'This skill should load.',
      intents: ['bugfix'],
      routes: ['execute'],
      tags: ['bugfix'],
      priority: 100,
    });

    const skills = await loadDiskSkills({
      workspaceRoot: root,
      includeBundled: false,
    });

    expect(skills.map((skill) => skill.id)).toEqual(['enabled-skill']);
  });

  it('loads bundled roots and lets workspace skills override by id', async () => {
    const bundledRoot = join(root, 'bundled-skills');
    await writeSkillToRoot(bundledRoot, 'review-playbook', {
      description: 'Bundled review defaults.',
      intents: ['review'],
      routes: ['repository_answer'],
      tags: ['review'],
      priority: 100,
    });
    await writeSkill(root, 'review-playbook', {
      description: 'Workspace override review defaults.',
      intents: ['review'],
      routes: ['repository_answer'],
      tags: ['review'],
      priority: 180,
    });

    const skills = await loadDiskSkills({
      bundledRoots: [bundledRoot],
      includeBundled: false,
      workspaceRoot: root,
    });

    expect(skills.map((skill) => skill.id)).toEqual(['review-playbook']);
    expect(skills[0]?.content).toContain('Workspace override review defaults');
    expect(skills[0]?.priority).toBe(180);
  });

  it('loads the SDK bundled markdown skills by default', async () => {
    const skills = await loadDiskSkills({ workspaceRoot: root });

    expect(skills.map((skill) => skill.id)).toEqual(
      expect.arrayContaining([
        'ask-concise',
        'bugfix-localize',
        'planning-default',
        'safety-always',
        'spec-driven-development',
        'planning-and-task-breakdown',
        'incremental-implementation',
        'test-driven-development',
        'debugging-and-error-recovery',
        'code-review-and-quality',
        'security-and-hardening',
        'git-workflow-and-versioning',
      ]),
    );
  });

  it('selects the bundled planning skill for plan requests', async () => {
    const pipeline = new SkillsPipeline({
      catalog: createFileSystemSkillsCatalog({
        workspaceRoot: root,
      }),
    });

    const result = await pipeline.select({
      schemaVersion: SKILLS_SCHEMA_VERSION,
      query: 'Create a plan before implementing SSO login',
      mode: 'plan',
      route: 'plan',
      evidence: {
        primaryIntent: 'feature',
        secondaryIntents: [],
      },
    });

    expect(result.status).toBe('selected');
    // Engineering pack planning skill shares conflictGroup "planning" and
    // outranks planning-default (priority 190 > 180).
    expect(result.instructions.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(['planning-and-task-breakdown']),
    );
    expect(
      result.instructions.find(
        (skill) => skill.id === 'planning-and-task-breakdown',
      )?.content,
    ).toContain('# Planning');
  });
});

async function writeSkill(
  root: string,
  id: string,
  params: {
    description: string;
    intents: readonly string[];
    routes: readonly string[];
    tags: readonly string[];
    paths?: readonly string[];
    priority: number;
  },
): Promise<void> {
  await writeSkillToRoot(join(root, '.mitii', 'skills'), id, params);
}

async function writeSkillToRoot(
  skillsRoot: string,
  id: string,
  params: {
    description: string;
    intents: readonly string[];
    routes: readonly string[];
    tags: readonly string[];
    paths?: readonly string[];
    priority: number;
  },
): Promise<void> {
  const dir = join(skillsRoot, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---
name: ${id}
description: ${params.description}
intents: [${params.intents.join(', ')}]
routes: [${params.routes.join(', ')}]
tags: [${params.tags.join(', ')}]
${params.paths ? `paths: [${params.paths.join(', ')}]\n` : ''}
priority: ${params.priority}
---

Full body for ${id}.
`,
    'utf8',
  );
}
