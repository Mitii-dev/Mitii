/** Repository index status, reindex and pause. */

import {
  authHeaders,
} from './http.js';

export async function fetchIndexStatus(options: {
  baseUrl: string;
  token?: string;
}): Promise<{
  indexed: boolean;
  fileCount: number;
  truncated: boolean;
  lastIndexedAt?: string;
  message: string;
  running?: boolean;
  lockStartedAt?: number;
  progressPercent?: number;
  progressStage?: string;
  progressMessage?: string;
  embeddingError?: string;
  lexicalReady?: boolean;
  embeddingPhase?: string;
  health?: {
    overall: string;
    pipelines: {
      codeIndex: { status: string; reason?: string };
      textFts: { status: string; reason?: string };
      embeddings: { status: string; reason?: string; profileId?: string };
      graph: { status: string };
      map: { status: string };
      treeSitter: { status: string };
    };
    native: { sqlite: string; lancedb: string; onnx: string };
  };
}> {
  const res = await fetch(`${options.baseUrl}/v1/index/status`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`index_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchIndexStatus>>;
}

export type IndexReindexProgressEvent = {
  type: 'progress';
  stage: string;
  message: string;
  percent?: number;
  fileCount?: number;
  lexicalReady?: boolean;
  embeddingPhase?: string;
};

export type IndexReindexResultEvent = {
  type: 'result';
  status: string;
  fileCount: number;
  message: string;
  truncated?: boolean;
  statusSnapshot?: Awaited<ReturnType<typeof fetchIndexStatus>>;
};

export async function reindexWorkspace(options: {
  baseUrl: string;
  token?: string;
  maximumFiles?: number;
  concurrency?: number;
  /** Full rebuild — only when user clicks Rebuild. Default false. */
  force?: boolean;
  filePaths?: readonly string[];
  semanticIndex?: Record<string, unknown>;
  onProgress?: (event: IndexReindexProgressEvent) => void;
}): Promise<{
  status: string;
  fileCount: number;
  message: string;
  statusSnapshot?: Awaited<ReturnType<typeof fetchIndexStatus>>;
}> {
  const res = await fetch(`${options.baseUrl}/v1/index/reindex`, {
    method: 'POST',
    headers: {
      ...authHeaders(options.token),
      Accept: 'application/x-ndjson',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      maximumFiles: options.maximumFiles,
      concurrency: options.concurrency,
      semanticIndex: options.semanticIndex,
      force: options.force === true,
      ...(options.filePaths?.length ? { filePaths: options.filePaths } : {}),
      stream: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`reindex_${res.status}:${text}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('ndjson') || !res.body) {
    return (await res.json()) as Awaited<ReturnType<typeof reindexWorkspace>>;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: IndexReindexResultEvent | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: { type?: string } & Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as { type?: string } & Record<
          string,
          unknown
        >;
      } catch {
        continue;
      }
      if (parsed.type === 'progress') {
        options.onProgress?.(parsed as IndexReindexProgressEvent);
      } else if (parsed.type === 'result') {
        result = parsed as IndexReindexResultEvent;
      } else if (parsed.type === 'error') {
        throw new Error(
          typeof parsed.message === 'string'
            ? parsed.message
            : 'reindex_failed',
        );
      }
    }
  }

  if (!result) {
    throw new Error('reindex_incomplete');
  }
  return {
    status: result.status,
    fileCount: result.fileCount,
    message: result.message,
    statusSnapshot: result.statusSnapshot,
  };
}

export async function pauseIndexing(options: {
  baseUrl: string;
  token?: string;
}): Promise<{ paused: boolean; message: string }> {
  const res = await fetch(`${options.baseUrl}/v1/index/pause`, {
    method: 'POST',
    headers: {
      ...authHeaders(options.token),
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`index_pause_${res.status}:${text}`);
  }
  const body = (await res.json()) as {
    paused?: boolean;
    ok?: boolean;
    message?: string;
  };
  const paused = body.paused === true || body.ok === true;
  return {
    paused,
    message:
      body.message ??
      (paused
        ? 'Pause requested — finishing the current file, then stopping.'
        : 'No active index run to pause.'),
  };
}
