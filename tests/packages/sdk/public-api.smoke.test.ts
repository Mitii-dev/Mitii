import { describe, expect, it } from 'vitest';
import {
  MitiiSdkError,
  createMitiiClient,
  mitiiStartInputSchema,
  mitiiResumeInputSchema,
  AGENT_ENGINE_SCHEMA_VERSION,
} from '@mitii/sdk';
import { EchoLlmPort } from '@mitii/v8';

describe('tests/packages/sdk — public @mitii/sdk consumer smoke', () => {
  it('validates start input and rejects empty prompts', () => {
    expect(mitiiStartInputSchema.safeParse({ prompt: '' }).success).toBe(false);
    expect(
      mitiiStartInputSchema.safeParse({ prompt: 'hello', mode: 'ask' }).success,
    ).toBe(true);
  });

  it('requires approval or clarification on resume input', () => {
    expect(
      mitiiResumeInputSchema.safeParse({
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: 'run-1',
      }).success,
    ).toBe(false);
    expect(
      mitiiResumeInputSchema.safeParse({
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: 'run-1',
        approval: { approvalId: 'a1', decision: 'approved' },
      }).success,
    ).toBe(true);
  });

  it('creates a client and throws MitiiSdkError on invalid start', () => {
    const llm = new EchoLlmPort();
    const client = createMitiiClient({
      understandingLlm: llm,
      runLlm: llm,
    });
    expect(() => client.start({ prompt: '' })).toThrow(MitiiSdkError);
  });
});
