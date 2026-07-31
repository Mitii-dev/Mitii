import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FileRunCheckpointStore,
  type AgentRunCheckpoint,
} from '..';

function sampleCheckpoint(
  overrides: Partial<AgentRunCheckpoint> = {},
): AgentRunCheckpoint {
  return {
    runId: 'run_abc-123',
    requestId: 'req_1',
    suspensionKind: 'approval_required',
    input: {
      requestId: 'req_1',
      sessionId: 'session_1',
      mode: 'agent',
      message: 'patch login',
    } as AgentRunCheckpoint['input'],
    decision: {
      route: 'execute',
    } as AgentRunCheckpoint['decision'],
    messages: [{ role: 'user', content: 'patch login' }],
    toolCacheEntries: [],
    changedFiles: [],
    mutationCheckpointIds: [],
    reasonCodes: [],
    warnings: [],
    usage: {
      modelCalls: 1,
      toolCalls: 0,
      loopIterations: 1,
      inputTokens: 10,
      outputTokens: 5,
    },
    startedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe('FileRunCheckpointStore', () => {
  it('persists across instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mitii-checkpoints-'));
    try {
      const store = new FileRunCheckpointStore(directory);
      const checkpoint = sampleCheckpoint();
      await store.save(checkpoint);

      const reloaded = new FileRunCheckpointStore(directory);
      const loaded = await reloaded.load(checkpoint.runId);
      expect(loaded).toBeTruthy();
      expect(loaded?.runId).toBe(checkpoint.runId);
      expect(loaded?.requestId).toBe(checkpoint.requestId);
      expect(loaded?.suspensionKind).toBe('approval_required');
      expect(loaded?.messages).toEqual(checkpoint.messages);

      await reloaded.delete(checkpoint.runId);
      expect(await reloaded.load(checkpoint.runId)).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects empty directory', () => {
    expect(() => new FileRunCheckpointStore('  ')).toThrow(
      /non-empty directory/,
    );
  });
});
