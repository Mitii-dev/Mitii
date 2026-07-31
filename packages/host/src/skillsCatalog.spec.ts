import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SkillsPipeline, SKILLS_SCHEMA_VERSION } from '@mitii/v8';

import {
  createFileSystemSkillsCatalog,
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

    const skills = await loadDiskSkills({ workspaceRoot: root });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'null-crash-debugging',
      title: 'Null Crash Debugging',
      intents: ['bugfix', 'diagnose'],
      routes: ['execute', 'diagnose'],
      tags: ['null', 'crash', 'test'],
      priority: 150,
      conflictGroup: 'debugging',
      alwaysApply: false,
    });
    expect(skills[0]?.content).toContain(
      'Description: Find and fix nullable-value crashes',
    );
    expect(skills[0]?.content).not.toContain('Long internal playbook');
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
    expect(result.instructions[0]?.content).toContain('Description:');
    expect(result.instructions[0]?.content).not.toContain('docs-writing');
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

    const skills = await loadDiskSkills({ workspaceRoot: root });

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
      workspaceRoot: root,
    });

    expect(skills.map((skill) => skill.id)).toEqual(['review-playbook']);
    expect(skills[0]?.content).toContain('Workspace override review defaults');
    expect(skills[0]?.priority).toBe(180);
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
priority: ${params.priority}
---

Full body for ${id}.
`,
    'utf8',
  );
}
