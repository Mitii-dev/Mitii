/** Workspace memory API. */

import {
  authHeaders,
} from './http.js';

export interface MemoryItemView {
  id: string;
  text: string;
  createdAt: string;
}

export async function fetchMemories(options: {
  baseUrl: string;
  token?: string;
}): Promise<MemoryItemView[]> {
  const res = await fetch(`${options.baseUrl}/v1/memory`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`memory_${res.status}:${text}`);
  }
  const data = (await res.json()) as { memories?: MemoryItemView[] };
  return Array.isArray(data.memories) ? data.memories : [];
}

export async function addMemory(options: {
  baseUrl: string;
  token?: string;
  text: string;
}): Promise<MemoryItemView[]> {
  const res = await fetch(`${options.baseUrl}/v1/memory`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ text: options.text }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`memory_add_${res.status}:${text}`);
  }
  const data = (await res.json()) as { memories?: MemoryItemView[] };
  return Array.isArray(data.memories) ? data.memories : [];
}

export async function deleteMemory(options: {
  baseUrl: string;
  token?: string;
  id: string;
}): Promise<MemoryItemView[]> {
  const res = await fetch(
    `${options.baseUrl}/v1/memory/${encodeURIComponent(options.id)}`,
    {
      method: 'DELETE',
      headers: authHeaders(options.token),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`memory_delete_${res.status}:${text}`);
  }
  const data = (await res.json()) as { memories?: MemoryItemView[] };
  return Array.isArray(data.memories) ? data.memories : [];
}

export async function clearMemories(options: {
  baseUrl: string;
  token?: string;
}): Promise<void> {
  const res = await fetch(`${options.baseUrl}/v1/memory/clear`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`memory_clear_${res.status}:${text}`);
  }
}
