/** Desktop engine routes: profiles. */

import {
  activateProfile,
  deleteProfile,
  hashSecret,
  profileFromProvider,
  readProfiles,
  uniqueProfileId,
  upsertProfile,
  writeProfiles,
  type DesktopProfileProvider,
} from '../profiles.js';
import {
  sendJson,
  requireAuth,
  readJsonBody,
} from '../http/httpUtils.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';

function fallbackProviderFromEnv(): DesktopProfileProvider {
  return {
    type: process.env.MITII_PROVIDER ?? 'echo',
    preset: process.env.MITII_PROVIDER_PRESET ?? process.env.MITII_PROVIDER ?? 'echo',
    baseUrl: process.env.MITII_BASE_URL ?? '',
    model: process.env.MITII_MODEL ?? '',
    contextWindow: 0,
    maximumOutputTokens: 0,
  };
}

async function handleGetProfiles(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const hasSecret = Boolean(process.env.MITII_API_KEY?.trim());
  const file = readProfiles(cwd, fallbackProviderFromEnv(), {
    hasSecret,
    secretHash: hashSecret(process.env.MITII_API_KEY),
  });
  sendJson(res, 200, file);
}

async function handlePostProfiles(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const action = String(body.action ?? 'upsert');
  let file = readProfiles(cwd, fallbackProviderFromEnv(), {
    hasSecret: Boolean(process.env.MITII_API_KEY?.trim()),
    secretHash: hashSecret(process.env.MITII_API_KEY),
  });

  if (action === 'activate') {
    const id = String(body.profileId ?? '');
    const next = activateProfile(file, id);
    if (!next) {
      sendJson(res, 404, { ok: false, error: 'profile_not_found' });
      return;
    }
    writeProfiles(cwd, next);
    const active = next.profiles.find((p) => p.id === id)!;
    sendJson(res, 200, { ok: true, profiles: next, active });
    return;
  }

  if (action === 'delete') {
    const id = String(body.profileId ?? '');
    const next = deleteProfile(file, id);
    if (!next) {
      sendJson(res, 400, {
        ok: false,
        error: 'cannot_delete_last_or_missing',
      });
      return;
    }
    writeProfiles(cwd, next);
    sendJson(res, 200, { ok: true, profiles: next });
    return;
  }

  const provider = (body.provider ?? {}) as Record<string, unknown>;
  const requestedId =
    typeof body.id === 'string' && body.id.trim()
      ? body.id.trim()
      : undefined;
  const requestedName =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim()
      : 'Profile';
  const profile = profileFromProvider(
    {
      type: String(provider.type ?? 'echo'),
      preset:
        typeof provider.preset === 'string'
          ? provider.preset
          : String(provider.type ?? 'echo'),
      baseUrl: String(provider.baseUrl ?? ''),
      model: String(provider.model ?? ''),
      contextWindow: Number(provider.contextWindow) || 0,
      maximumOutputTokens: Number(provider.maximumOutputTokens) || 0,
    },
    {
      id:
        requestedId ??
        // New profiles must not reuse the reserved "default" id.
        uniqueProfileId(requestedName, file.profiles),
      name: requestedName,
      hasSecret: Boolean(body.hasSecret ?? process.env.MITII_API_KEY),
      secretHash: hashSecret(
        typeof body.apiKey === 'string'
          ? body.apiKey
          : process.env.MITII_API_KEY,
      ),
    },
  );
  file = upsertProfile(file, profile);
  writeProfiles(cwd, file);
  sendJson(res, 200, { ok: true, profiles: file, profile });
}

export const profilesRoutes: readonly Route[] = [
  { method: 'GET', path: '/v1/profiles', handle: handleGetProfiles },
  { method: 'POST', path: '/v1/profiles', handle: handlePostProfiles },
];
