/**
 * Minimal absolute paths a sandboxed child may need to read to load
 * dynamic libraries, certificates, and locale data. Workspace and
 * explicit readablePaths are layered on top by each backend.
 */
export const MACOS_PLATFORM_READ_PATHS: readonly string[] = [
  '/usr/lib',
  '/usr/bin',
  '/usr/sbin',
  '/bin',
  '/sbin',
  '/dev',
  '/etc',
  '/private/etc',
  '/private/var/db/timezone',
  '/var/db/timezone',
  '/System/Library/Frameworks',
  '/System/Library/PrivateFrameworks',
  '/System/Library/SubFrameworks',
  '/System/Library/CoreServices',
  '/Library/Preferences/Logging',
  '/Library/Apple',
];

export const LINUX_PLATFORM_READ_PATHS: readonly string[] = [
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/lib32',
  '/etc',
  '/dev',
  '/proc',
  '/sys',
  '/run',
];

export function writableDefaults(workspaceRoot: string): string[] {
  return [workspaceRoot, '/tmp', '/private/tmp', '/var/folders'];
}
