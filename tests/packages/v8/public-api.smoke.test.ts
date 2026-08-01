import { describe, expect, it } from 'vitest';
import {
  RequestIntakePipeline,
  createUserRequestInputSchema,
  repositoryStateReferenceSchema,
  agentEngineStartInputSchema,
  AGENT_ENGINE_SCHEMA_VERSION,
  composeReadOnlyAgentEngine,
  EchoLlmPort,
  createWorkspaceIndexRuntime,
  createWorkspaceRetrievalRuntime,
} from '@mitii/v8';

describe('tests/packages/v8 — public @mitii/v8 consumer smoke', () => {
  it('exports intake facade and validates create-user-request input', () => {
    expect(typeof RequestIntakePipeline).toBe('function');
    const parsed = createUserRequestInputSchema.safeParse({
      sessionId: 'session-1',
      mode: 'ask',
      userMessage: 'What does this repo do?',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects empty state tokens on repository state reference', () => {
    const parsed = repositoryStateReferenceSchema.safeParse({
      workspaceId: 'ws',
      stateToken: '',
    });
    expect(parsed.success).toBe(false);
  });

  it('composes a read-only engine over public ports', () => {
    const llm = new EchoLlmPort();
    const engine = composeReadOnlyAgentEngine({
      understandingLlm: llm,
      runLlm: llm,
    });
    expect(engine).toBeTruthy();
    const start = agentEngineStartInputSchema.safeParse({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      request: {
        sessionId: 'session-1',
        mode: 'ask',
        userMessage: 'ping',
      },
    });
    expect(start.success).toBe(true);
  });

  it('exports the workspace index runtime facade', () => {
    expect(typeof createWorkspaceIndexRuntime).toBe('function');
    expect(typeof createWorkspaceRetrievalRuntime).toBe('function');
  });
});
