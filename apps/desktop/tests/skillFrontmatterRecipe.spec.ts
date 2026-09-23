import { describe, expect, it } from 'vitest';

import {
  composeSkillMarkdown,
  fallbackSkillFrontmatter,
  parseFrontmatterFromModelText,
  splitSkillMarkdown,
} from '../src/engine/skillFrontmatterRecipe.js';

describe('skillFrontmatterRecipe', () => {
  it('preserves body when composing markdown', () => {
    const body = '# Module Doc Generator\n\nWrite README.md in the module root.\n';
    const fields = fallbackSkillFrontmatter({
      nameHint: 'module-doc-generator',
      titleHint: 'Module Doc Generator',
      body,
    });
    const markdown = composeSkillMarkdown(fields, body);
    const split = splitSkillMarkdown(markdown);
    expect(split.body).toContain('Write README.md in the module root.');
    expect(markdown).toContain('name: module-doc-generator');
    expect(markdown).toContain('enabled: true');
  });

  it('parses model frontmatter output', () => {
    const parsed = parseFrontmatterFromModelText(`---
name: module-doc-generator
title: Module Doc Generator
description: Generate a single module README from source and background markdown.
intents: [docs]
routes: [execute]
tags: [docs, readme, documentation, module-doc-generator]
priority: 220
when: [User asks to generate module docs, User names module-doc-generator]
instruction: Follow the module-doc-generator playbook; write README.md in the module root.
enabled: true
---`);
    expect(parsed?.name).toBe('module-doc-generator');
    expect(parsed?.intents).toEqual(['docs']);
    expect(parsed?.priority).toBe(220);
  });
});
