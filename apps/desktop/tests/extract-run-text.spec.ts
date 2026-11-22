import { describe, expect, it } from 'vitest';

import {
  extractAssistantAnswer,
  extractAssistantDelta,
  extractRunError,
  sanitizeAssistantText,
} from '../src/shared/extract-run-text.js';

describe('extract-run-text', () => {
  it('reads model_delta content previews', () => {
    expect(
      extractAssistantDelta({
        type: 'model_delta',
        kind: 'content',
        preview: 'Hello',
      }),
    ).toBe('Hello');
    expect(
      extractAssistantDelta({
        type: 'model_delta',
        kind: 'reasoning',
        preview: 'think',
      }),
    ).toBe('');
    expect(
      extractAssistantDelta({
        type: 'model_delta',
        kind: 'tool_call',
        preview: 'read_file',
      }),
    ).toBe('');
  });

  it('strips working_set scaffolding from answers', () => {
    const raw =
      'Echo: <working_set trust="instruction">\nChecklist\n</working_set>\nReal answer';
    expect(sanitizeAssistantText(raw)).toBe('Real answer');
  });

  it('falls back to result.answer', () => {
    expect(extractAssistantAnswer({ answer: 'Final reply' })).toBe(
      'Final reply',
    );
    expect(extractRunError({ error: { message: 'boom' } })).toBe('boom');
  });
});
