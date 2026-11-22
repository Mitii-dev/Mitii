import { resolveCliArgs } from './resolve.js';
import { scanCliArgs } from './scan.js';
import type { ParsedCliArgs } from './types.js';

export type { ParsedCliArgs } from './types.js';
export { peelGlobalPassthroughFlags } from './helpers.js';

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const scanned = scanCliArgs(argv);
  return scanned.kind === 'early'
    ? scanned.result
    : resolveCliArgs(scanned.state);
}
