import type { SandboxPolicy } from '../../contracts/policy.js';
import {
  MACOS_PLATFORM_READ_PATHS,
  writableDefaults,
} from '../../helpers/platformReads.js';

function subpathRule(op: string, path: string): string {
  return `(${op} (subpath ${JSON.stringify(path)}))`;
}

/**
 * Seatbelt profile: deny-by-default, process spawn allowed, writes limited to
 * workspace / tmp / writablePaths, network gated by policy.
 * Read scope follows isolationProfile (strict | balanced | permissive).
 */
export function buildSeatbeltProfile(policy: SandboxPolicy): string {
  const profile = policy.isolationProfile ?? 'balanced';
  const writable = [
    ...writableDefaults(policy.workspaceRoot),
    ...(policy.writablePaths ?? []),
  ];
  const uniqueWritable = [...new Set(writable)];
  const writeRules = uniqueWritable
    .map((path) => subpathRule('allow file-write*', path))
    .join('\n  ');
  const denyReadRules = (policy.denyReadPaths ?? [])
    .map((path) => subpathRule('deny file-read*', path))
    .join('\n  ');

  const networkRule =
    policy.network === 'allow' ? '(allow network*)' : '(deny network*)';

  let readBlock: string;
  if (profile === 'permissive' || profile === 'balanced') {
    // Broad reads keep toolchain success high; writes/network stay fenced.
    readBlock = '(allow file-read*)';
  } else {
    const readable = [
      policy.workspaceRoot,
      ...writable,
      ...MACOS_PLATFORM_READ_PATHS,
      ...(policy.readablePaths ?? []),
    ];
    readBlock = [...new Set(readable)]
      .map((path) => subpathRule('allow file-read*', path))
      .join('\n  ');
  }

  return `
(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow sysctl-read)
(allow file-write-data (literal "/dev/null"))
(allow file-ioctl (literal "/dev/null"))
(allow file-read-data (literal "/dev/null"))
(allow file-read-metadata)
${readBlock}
${writeRules}
${denyReadRules}
${networkRule}
`.trim();
}
