import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type {
  EmbeddingProfile,
  EmbeddingProvider,
  LanceDbConnectionPort,
} from '@mitii/v8';

export interface SemanticIndexSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  dimensions: number;
  normalized: boolean;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface IndexRuntimeMetadata {
  schemaVersion: 1;
  workspaceId: string;
  sqlitePath: string;
  lanceDbPath: string;
  embeddingProfile: EmbeddingProfile;
  generatedAt: string;
}

export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly profile: EmbeddingProfile;

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly settings: SemanticIndexSettings) {
    this.fetchImpl = settings.fetchImpl ?? fetch;
    this.profile = {
      id: [
        'openai-compatible',
        settings.model,
        settings.dimensions,
        settings.normalized ? 'normalized' : 'raw',
      ].join(':'),
      providerId: 'openai-compatible',
      modelId: settings.model,
      dimensions: settings.dimensions,
      normalized: settings.normalized,
    };
  }

  async embed(
    texts: readonly string[],
    context?: { abortSignal?: AbortSignal },
  ): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    const response = await this.fetchImpl(this.embeddingsUrl(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.settings.model,
        input: texts,
        dimensions: this.settings.dimensions,
      }),
      signal: context?.abortSignal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Embedding provider failed (${response.status}): ${detail || response.statusText}`,
      );
    }
    const payload = (await response.json()) as {
      data?: Array<{ index?: number; embedding?: unknown }>;
    };
    const rows = payload.data ?? [];
    if (rows.length !== texts.length) {
      throw new Error(
        `Embedding provider returned ${rows.length} vectors for ${texts.length} inputs.`,
      );
    }
    return rows
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((row) => this.parseVector(row.embedding));
  }

  private embeddingsUrl(): string {
    const root = this.settings.baseUrl.replace(/\/$/, '');
    return `${root}/embeddings`;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.settings.apiKey
        ? { Authorization: `Bearer ${this.settings.apiKey}` }
        : {}),
    };
  }

  private parseVector(value: unknown): number[] {
    if (!Array.isArray(value)) {
      throw new Error('Embedding provider returned a non-array vector.');
    }
    const vector = value.map((item) => Number(item));
    if (
      vector.length !== this.settings.dimensions ||
      vector.some((item) => !Number.isFinite(item))
    ) {
      throw new Error(
        `Embedding vector dimensions do not match profile ${this.profile.id}.`,
      );
    }
    return vector;
  }
}

export async function createLanceDbConnection(
  path: string,
): Promise<LanceDbConnectionPort> {
  mkdirSync(path, { recursive: true });
  const mod = (await import('@lancedb/lancedb')) as {
    connect?: (uri: string) => Promise<LanceDbConnectionPort>;
  };
  if (typeof mod.connect !== 'function') {
    throw new Error('@lancedb/lancedb does not expose connect().');
  }
  return mod.connect(path);
}

export function writeIndexRuntimeMetadata(
  path: string,
  metadata: IndexRuntimeMetadata,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

export function readIndexRuntimeMetadata(
  path: string,
): IndexRuntimeMetadata | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as IndexRuntimeMetadata;
    if (
      parsed?.schemaVersion !== 1 ||
      !parsed.workspaceId ||
      !parsed.sqlitePath ||
      !parsed.lanceDbPath ||
      !parsed.embeddingProfile?.id
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0
  ) {
    return Math.floor(value);
  }
  return fallback;
}
