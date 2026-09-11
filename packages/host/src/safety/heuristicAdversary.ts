/**
 * Host heuristic ToolAdversaryPort (Phase 3).
 * Restrict-only. Default disabled via createHeuristicAdversary({ enabled: false }).
 */

import type {
  AdversaryEvaluateResult,
  ToolAdversaryPort,
} from '@mitii/v8';
import { isAdversaryHighRiskTool } from '@mitii/v8';

const BLOCK_PREFIXES = [
  'curl ',
  'wget ',
  'rm -rf /',
  'sudo ',
  'chmod 777',
  'dd if=',
  ':(){', // fork bomb
];

const ASK_PREFIXES = ['git push', 'git reset --hard', 'npm publish', 'pnpm publish'];

export interface HeuristicAdversaryOptions {
  enabled?: boolean;
  /** Extra deny command prefixes (case-insensitive). */
  blockCommandPrefixes?: string[];
  askCommandPrefixes?: string[];
}

export function createHeuristicAdversary(
  options: HeuristicAdversaryOptions = {},
): ToolAdversaryPort | undefined {
  if (options.enabled !== true) {
    return undefined;
  }

  const blockPrefixes = [
    ...BLOCK_PREFIXES,
    ...(options.blockCommandPrefixes ?? []),
  ].map((p) => p.toLowerCase());
  const askPrefixes = [
    ...ASK_PREFIXES,
    ...(options.askCommandPrefixes ?? []),
  ].map((p) => p.toLowerCase());

  return {
    evaluate(input): AdversaryEvaluateResult {
      if (!isAdversaryHighRiskTool(input.toolName)) {
        return { decision: 'ALLOW', reason: 'not_high_risk' };
      }

      if (
        input.toolName === 'delete_directory' ||
        input.toolName === 'delete_file'
      ) {
        const path =
          input.arguments &&
          typeof input.arguments === 'object' &&
          'path' in input.arguments
            ? String((input.arguments as { path?: unknown }).path ?? '')
            : '';
        if (
          path === '.' ||
          path === '/' ||
          path === '..' ||
          path.includes('..')
        ) {
          return {
            decision: 'BLOCK',
            reason: `Adversary blocked dangerous delete path: ${path || '(empty)'}`,
          };
        }
      }

      if (input.toolName === 'run_command') {
        const cmd = extractCommandText(input.arguments).toLowerCase();
        for (const prefix of blockPrefixes) {
          if (cmd.includes(prefix.trim()) || cmd.startsWith(prefix.trim())) {
            return {
              decision: 'BLOCK',
              reason: `Adversary blocked command matching "${prefix.trim()}"`,
            };
          }
        }
        for (const prefix of askPrefixes) {
          if (cmd.startsWith(prefix.trim()) || cmd.includes(` ${prefix.trim()}`)) {
            return {
              decision: 'ASK',
              reason: `Adversary requires approval for "${prefix.trim()}"`,
            };
          }
        }
      }

      return { decision: 'ALLOW', reason: 'heuristic_pass' };
    },
  };
}

function extractCommandText(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const record = args as Record<string, unknown>;
  if (typeof record.command === 'string') return record.command;
  if (Array.isArray(record.argv)) {
    return record.argv.map(String).join(' ');
  }
  if (typeof record.script === 'string') return record.script;
  return JSON.stringify(args).slice(0, 500);
}
