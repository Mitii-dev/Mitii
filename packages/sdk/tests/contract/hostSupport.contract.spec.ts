import { describe, expect, it } from 'vitest';
import * as v8 from '@mitii/v8';

import * as sdk from '@mitii/sdk';

describe('SDK host-support re-exports', () => {
  const runtimeSymbols = [
    'MemoryPipeline',
    'MemoryContentPolicy',
    'MEMORY_SCHEMA_VERSION',
    'memoryFactSchema',
    'serializePlanText',
    'WorkspaceIgnorePolicy',
    'isSecurityConcern',
    'CODE_NAVIGATION_OPERATIONS',
    'CODE_NAVIGATION_POLICY',
    'createRequestLimiter',
    'getApprovalPresetCopy',
    'formatApprovalPresetHelp',
  ] as const;

  it.each(runtimeSymbols)('re-exports %s identically to @mitii/v8', (name) => {
    expect((sdk as Record<string, unknown>)[name]).toBeDefined();
    expect((sdk as Record<string, unknown>)[name]).toBe(
      (v8 as Record<string, unknown>)[name],
    );
  });

  it('keeps re-exported helpers callable', () => {
    expect(typeof sdk.serializePlanText).toBe('function');
    expect(typeof sdk.isSecurityConcern).toBe('function');
    expect(typeof sdk.WorkspaceIgnorePolicy).toBe('function');
  });
});
