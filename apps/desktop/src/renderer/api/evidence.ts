/** Session log and diagnostic export API. */

import {
  authHeaders,
} from './http.js';

export async function openLatestSessionLog(options: {
  baseUrl: string;
  token?: string;
}): Promise<{ path?: string; content?: string; message?: string }> {
  const res = await fetch(
    `${options.baseUrl}/v1/evidence/session-log/latest`,
    { headers: authHeaders(options.token) },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`session_log_latest_${res.status}:${text}`);
  }
  return (await res.json()) as {
    path?: string;
    content?: string;
    message?: string;
  };
}

export async function exportSessionLog(options: {
  baseUrl: string;
  token?: string;
}): Promise<{ ok: boolean; path?: string }> {
  const res = await fetch(
    `${options.baseUrl}/v1/evidence/session-log/export`,
    {
      method: 'POST',
      headers: authHeaders(options.token),
      body: '{}',
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`session_log_export_${res.status}:${text}`);
  }
  return (await res.json()) as { ok: boolean; path?: string };
}

export async function exportShareableDiagnostic(options: {
  baseUrl: string;
  token?: string;
}): Promise<{ ok: boolean; path?: string }> {
  const res = await fetch(
    `${options.baseUrl}/v1/evidence/shareable-diagnostic`,
    {
      method: 'POST',
      headers: authHeaders(options.token),
      body: '{}',
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`shareable_diagnostic_${res.status}:${text}`);
  }
  return (await res.json()) as { ok: boolean; path?: string };
}

export async function exportAuditPack(options: {
  baseUrl: string;
  token?: string;
}): Promise<{ ok: boolean; path?: string }> {
  const res = await fetch(`${options.baseUrl}/v1/evidence/audit-pack`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`audit_pack_${res.status}:${text}`);
  }
  return (await res.json()) as { ok: boolean; path?: string };
}
