import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import {
  createWorkspaceIndexRuntime,
  createWorkspaceRetrievalRuntime,
} from '../index';
import type {
  EmbeddingProvider,
  LanceDbConnectionPort,
  LanceDbRow,
  LanceDbTablePort,
} from '../index';

const openDatabase = () =>
  new Database(
    join(mkdtempSync(join(tmpdir(), 'mitii-runtime-')), 'index.sqlite'),
  );

const provider: EmbeddingProvider = {
  profile: {
    id: 'test-provider:model:3:normalized',
    providerId: 'test-provider',
    modelId: 'model',
    dimensions: 3,
    normalized: true,
  },
  embed: async (texts) => texts.map(() => [1, 0, 0]),
};

const lanceConnection: LanceDbConnectionPort = {
  tableNames: async () => [],
  openTable: async (): Promise<LanceDbTablePort> => {
    throw new Error('not used by runtime composition');
  },
  createTable: async (
    _name: string,
    _data: LanceDbRow[],
  ): Promise<LanceDbTablePort> => {
    throw new Error('not used by runtime composition');
  },
};

describe('WorkspaceIndexRuntime adapters', () => {
  it('composes code and text indexes without vector', async () => {
    const database = openDatabase();
    try {
      const runtime = await createWorkspaceIndexRuntime({
        codeIndexDatabase: database,
        textIndexDatabase: database,
      });

      expect(runtime.synchronizeEmbeddings).toBe(false);
      expect(runtime.vectorIndex).toBeUndefined();
      expect(runtime.embeddingProvider).toBeUndefined();
      expect(typeof runtime.scanner.scan).toBe('function');
      expect(typeof runtime.pipeline.execute).toBe('function');
      expect(typeof runtime.textIndex.reader.search).toBe('function');
    } finally {
      database.close();
    }
  });

  it('composes embedding sync and vector reader together', async () => {
    const database = openDatabase();
    try {
      const runtime = await createWorkspaceIndexRuntime({
        codeIndexDatabase: database,
        textIndexDatabase: database,
        vector: {
          embeddingProvider: provider,
          lanceConnection,
        },
      });

      expect(runtime.synchronizeEmbeddings).toBe(true);
      expect(runtime.embeddingProvider).toBe(provider);
      expect(typeof runtime.vectorIndex?.search).toBe('function');
    } finally {
      database.close();
    }
  });

  it('creates a read-only retrieval runtime without migrations side effects', () => {
    const database = openDatabase();
    try {
      const runtime = createWorkspaceRetrievalRuntime({
        textIndexDatabase: database,
        vector: {
          embeddingProvider: provider,
          lanceConnection,
        },
      });

      expect(typeof runtime.textIndex.search).toBe('function');
      expect(typeof runtime.vectorIndex?.search).toBe('function');
      expect(runtime.embeddingProvider).toBe(provider);
    } finally {
      database.close();
    }
  });
});
