import { describe, expect, it } from 'vitest';

import {
  buildConversationCarry,
  collectStructuredCarryFromThread,
} from '../src/shared/conversationCarry.js';

describe('buildConversationCarry', () => {
  it('forwards prior turns so a choice like "1" keeps context', () => {
    const carried = buildConversationCarry({
      messages: [
        { role: 'user', text: 'List the tests' },
        {
          role: 'assistant',
          text: 'Here are options:\n1. Fix import\n2. Add spec\nWhich one?',
        },
      ],
      currentPrompt: '1',
      mode: 'ask',
    });

    expect(carried).toEqual([
      { role: 'user', content: 'List the tests' },
      {
        role: 'assistant',
        content: 'Here are options:\n1. Fix import\n2. Add spec\nWhich one?',
      },
    ]);
  });

  it('drops a trailing user turn that duplicates currentPrompt', () => {
    const carried = buildConversationCarry({
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi' },
        { role: 'user', text: '1' },
      ],
      currentPrompt: '1',
      mode: 'ask',
    });

    expect(carried).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
  });

  it('includes structured handoff for agent mode when files changed', () => {
    const structured = collectStructuredCarryFromThread({
      messages: [
        {
          fileChanges: { files: [{ path: 'src/a.ts' }] },
          activity: [],
        },
      ],
    });
    const carried = buildConversationCarry({
      messages: [{ role: 'user', text: 'continue' }],
      currentPrompt: 'continue',
      mode: 'agent',
      structured,
    });

    expect(carried[0]?.role).toBe('user');
    expect(carried[0]?.content).toContain('<carry_handoff>');
    expect(carried[0]?.content).toContain('src/a.ts');
  });
});
