/** Workspace explorer file API. */

import {
  authHeaders,
} from './http.js';

export async function fetchWorkspaceTree(options: {
  baseUrl: string;
  token?: string;
  path?: string;
}): Promise<{
  path: string;
  entries: Array<{ name: string; path: string; kind: 'file' | 'dir' }>;
}> {
  const qs = options.path
    ? `?path=${encodeURIComponent(options.path)}`
    : '';
  const res = await fetch(`${options.baseUrl}/v1/workspace/tree${qs}`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`tree_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchWorkspaceTree>>;
}

export type WorkspaceEventsMessage =
  | { type: 'ready'; at: number; workspaceRoot?: string }
  | { type: 'ping'; at: number }
  | {
      type: 'change';
      at: number;
      paths: string[];
      kind?: string;
    };

/** Long-lived NDJSON stream of workspace filesystem changes. */
export async function* streamWorkspaceEvents(options: {
  baseUrl: string;
  token?: string;
  signal?: AbortSignal;
}): AsyncGenerator<WorkspaceEventsMessage> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/events`, {
    headers: authHeaders(options.token),
    signal: options.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`workspace_events_${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          yield JSON.parse(line) as WorkspaceEventsMessage;
        } catch {
          /* skip bad line */
        }
      }
      newline = buffer.indexOf('\n');
    }
  }
}

export async function searchWorkspacePaths(options: {
  baseUrl: string;
  token?: string;
  query: string;
}): Promise<Array<{ path: string; kind: 'file' | 'folder' }>> {
  const res = await fetch(
    `${options.baseUrl}/v1/workspace/search?q=${encodeURIComponent(options.query)}`,
    { headers: authHeaders(options.token) },
  );
  if (!res.ok) throw new Error(`search_${res.status}`);
  const json = (await res.json()) as {
    paths?: Array<string | { path?: string; kind?: string }>;
  };
  const raw = Array.isArray(json.paths) ? json.paths : [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') {
        return { path: entry, kind: 'file' as const };
      }
      const path = typeof entry.path === 'string' ? entry.path : '';
      if (!path) return null;
      return {
        path,
        kind: entry.kind === 'folder' ? ('folder' as const) : ('file' as const),
      };
    })
    .filter((entry): entry is { path: string; kind: 'file' | 'folder' } =>
      Boolean(entry),
    );
}

export async function fetchWorkspaceFile(options: {
  baseUrl: string;
  token?: string;
  path: string;
}): Promise<{
  path: string;
  content: string;
  truncated: boolean;
  size: number;
}> {
  const res = await fetch(
    `${options.baseUrl}/v1/workspace/file?path=${encodeURIComponent(options.path)}`,
    { headers: authHeaders(options.token) },
  );
  if (!res.ok) throw new Error(`file_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchWorkspaceFile>>;
}

export async function saveWorkspaceFile(options: {
  baseUrl: string;
  token?: string;
  path: string;
  content: string;
}): Promise<{ ok: boolean; path: string; size: number }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/file`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ path: options.path, content: options.content }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`save_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof saveWorkspaceFile>>;
}

export async function renameWorkspacePath(options: {
  baseUrl: string;
  token?: string;
  path: string;
  newName: string;
}): Promise<{ ok: boolean; path: string; previousPath: string }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/rename`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ path: options.path, newName: options.newName }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`rename_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof renameWorkspacePath>>;
}

export async function deleteWorkspacePaths(options: {
  baseUrl: string;
  token?: string;
  paths: string[];
}): Promise<{ ok: boolean; deleted: string[] }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/delete`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ paths: options.paths }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`delete_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof deleteWorkspacePaths>>;
}

export async function createWorkspaceFilePath(options: {
  baseUrl: string;
  token?: string;
  parent: string;
  name: string;
  content?: string;
}): Promise<{ ok: boolean; path: string }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/create-file`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      parent: options.parent,
      name: options.name,
      content: options.content ?? '',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`create_file_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<
    ReturnType<typeof createWorkspaceFilePath>
  >;
}

export async function createWorkspaceFolderPath(options: {
  baseUrl: string;
  token?: string;
  parent: string;
  name: string;
}): Promise<{ ok: boolean; path: string }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/create-folder`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ parent: options.parent, name: options.name }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`create_folder_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<
    ReturnType<typeof createWorkspaceFolderPath>
  >;
}

export async function copyWorkspacePaths(options: {
  baseUrl: string;
  token?: string;
  paths: string[];
  destDir: string;
}): Promise<{ ok: boolean; results: Array<{ from: string; to: string }> }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/copy`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ paths: options.paths, destDir: options.destDir }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`copy_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof copyWorkspacePaths>>;
}

export async function moveWorkspacePaths(options: {
  baseUrl: string;
  token?: string;
  paths: string[];
  destDir: string;
}): Promise<{ ok: boolean; results: Array<{ from: string; to: string }> }> {
  const res = await fetch(`${options.baseUrl}/v1/workspace/move`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ paths: options.paths, destDir: options.destDir }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`move_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof moveWorkspacePaths>>;
}

export async function fetchAbsoluteWorkspacePath(options: {
  baseUrl: string;
  token?: string;
  path: string;
}): Promise<string> {
  const res = await fetch(
    `${options.baseUrl}/v1/workspace/absolute?path=${encodeURIComponent(options.path)}`,
    { headers: authHeaders(options.token) },
  );
  if (!res.ok) throw new Error(`abs_${res.status}`);
  const json = (await res.json()) as { absolute?: string };
  if (!json.absolute) throw new Error('abs_missing');
  return json.absolute;
}
