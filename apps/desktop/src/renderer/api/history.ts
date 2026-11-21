/** Chat history API. */

import {
  authHeaders,
} from './http.js';

export async function fetchHistory(options: {
  baseUrl: string;
  token?: string;
}): Promise<{
  threads: Array<{
    id: string;
    title: string;
    updatedAt: string;
    messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      text: string;
      mode?: string;
    }>;
  }>;
  activeThreadId?: string;
}> {
  const res = await fetch(`${options.baseUrl}/v1/history`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`history_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchHistory>>;
}

export async function postHistory(options: {
  baseUrl: string;
  token?: string;
  body: Record<string, unknown>;
}): Promise<Awaited<ReturnType<typeof fetchHistory>>> {
  const res = await fetch(`${options.baseUrl}/v1/history`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify(options.body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`history_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof fetchHistory>>;
}

export async function deleteHistoryThread(options: {
  baseUrl: string;
  token?: string;
  threadId: string;
}): Promise<Awaited<ReturnType<typeof fetchHistory>>> {
  return postHistory({
    baseUrl: options.baseUrl,
    token: options.token,
    body: { action: 'delete', threadId: options.threadId },
  });
}
