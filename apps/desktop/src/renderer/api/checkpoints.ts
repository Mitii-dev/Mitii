/** Checkpoint list / restore API. */

import {
  authHeaders,
} from './http.js';

export interface CheckpointItemView {
  id: string;
  label: string;
  createdAt: string;
  changedPaths?: string[];
}

export async function fetchCheckpoints(options: {
  baseUrl: string;
  token?: string;
}): Promise<CheckpointItemView[]> {
  const res = await fetch(`${options.baseUrl}/v1/checkpoints`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`checkpoints_${res.status}:${text}`);
  }
  const data = (await res.json()) as { checkpoints?: CheckpointItemView[] };
  return Array.isArray(data.checkpoints) ? data.checkpoints : [];
}

export async function deleteCheckpoint(options: {
  baseUrl: string;
  token?: string;
  id: string;
}): Promise<CheckpointItemView[]> {
  const res = await fetch(
    `${options.baseUrl}/v1/checkpoints/${encodeURIComponent(options.id)}`,
    {
      method: 'DELETE',
      headers: authHeaders(options.token),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`checkpoint_delete_${res.status}:${text}`);
  }
  const data = (await res.json()) as { checkpoints?: CheckpointItemView[] };
  return Array.isArray(data.checkpoints) ? data.checkpoints : [];
}

export async function clearCheckpoints(options: {
  baseUrl: string;
  token?: string;
}): Promise<void> {
  const res = await fetch(`${options.baseUrl}/v1/checkpoints/clear`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`checkpoints_clear_${res.status}:${text}`);
  }
}

export async function restoreCheckpoint(options: {
  baseUrl: string;
  token?: string;
  id: string;
}): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(
    `${options.baseUrl}/v1/checkpoints/${encodeURIComponent(options.id)}/restore`,
    {
      method: 'POST',
      headers: authHeaders(options.token),
      body: '{}',
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`checkpoint_restore_${res.status}:${text}`);
  }
  return (await res.json()) as { ok: boolean; message: string };
}
