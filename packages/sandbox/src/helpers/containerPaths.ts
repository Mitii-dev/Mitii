import path from 'node:path';
import { platform as osPlatform } from 'node:os';

function resolverFor(os: NodeJS.Platform) {
  return os === 'win32' ? path.win32 : path.posix;
}

/**
 * Map a host absolute path into the path seen inside a Linux container.
 * On Windows, `C:\Users\a\ws` → `/c/Users/a/ws` (Docker Desktop / Podman).
 * Non-Windows hosts pass paths through unchanged.
 */
export function toContainerPath(
  hostPath: string,
  os: NodeJS.Platform = osPlatform(),
): string {
  const resolve = resolverFor(os);
  const resolved = resolve.resolve(hostPath);
  if (os !== 'win32') {
    return resolved;
  }
  const normalized = resolved.replace(/\\/g, '/');
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!match) {
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }
  const drive = match[1]!.toLowerCase();
  const rest = match[2] ?? '';
  return rest ? `/${drive}/${rest}` : `/${drive}`;
}

/**
 * Volume spec `host:container` for docker/podman.
 * Left side stays the host-native path; right side is the Linux container path.
 */
export function toVolumeSpec(
  hostPath: string,
  os: NodeJS.Platform = osPlatform(),
): string {
  const resolve = resolverFor(os);
  const host = resolve.resolve(hostPath);
  const container = toContainerPath(host, os);
  return `${host}:${container}`;
}

/**
 * Map a host cwd into the container filesystem. Paths under workspaceRoot
 * stay under the mounted container workspace root.
 */
export function mapCwdToContainer(params: {
  cwd: string | undefined;
  workspaceRoot: string;
  os?: NodeJS.Platform;
}): string {
  const os = params.os ?? osPlatform();
  const resolve = resolverFor(os);
  const sep = os === 'win32' ? path.win32.sep : path.posix.sep;
  const root = resolve.resolve(params.workspaceRoot);
  const cwd = params.cwd?.trim() ? resolve.resolve(params.cwd) : root;
  if (os !== 'win32') {
    return cwd;
  }
  const containerRoot = toContainerPath(root, os);
  if (cwd === root) {
    return containerRoot;
  }
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (!cwd.startsWith(prefix) && cwd !== root) {
    return toContainerPath(cwd, os);
  }
  const rel = resolve
    .relative(root, cwd)
    .split(/[/\\]/)
    .filter(Boolean)
    .join('/');
  return rel ? `${containerRoot}/${rel}` : containerRoot;
}
