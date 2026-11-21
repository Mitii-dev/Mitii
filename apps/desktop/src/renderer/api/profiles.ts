/** Provider profile API. */

import {
  authHeaders,
} from './http.js';

export async function fetchProfiles(options: {
  baseUrl: string;
  token?: string;
}): Promise<{
  activeProfileId: string;
  profiles: Array<{
    id: string;
    name: string;
    provider: {
      type: string;
      preset?: string;
      baseUrl: string;
      model: string;
      contextWindow: number;
      maximumOutputTokens: number;
    };
    hasSecret: boolean;
  }>;
}> {
  const res = await fetch(`${options.baseUrl}/v1/profiles`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`profiles_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchProfiles>>;
}

export async function postProfiles(options: {
  baseUrl: string;
  token?: string;
  body: Record<string, unknown>;
}): Promise<unknown> {
  const res = await fetch(`${options.baseUrl}/v1/profiles`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify(options.body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`profiles_${res.status}:${text}`);
  }
  return res.json();
}
