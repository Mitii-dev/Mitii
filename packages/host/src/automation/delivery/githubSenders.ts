import { spawnSync } from 'node:child_process';

import type { DeliverySender } from '@mitii/automation';

import { formatDeliveryMessage } from './formatMessage.js';

export interface CreateGithubDeliverySenderOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Inject for tests instead of spawning `gh`. */
  execGh?: (argv: string[], cwd: string) => { ok: boolean; stderr: string };
}

/**
 * Delivery via GitHub CLI: PR comments and Check Runs annotations (as comments
 * on the PR / issue referenced in target metadata).
 *
 * target formats:
 * - github_comment: `owner/repo#123` or metadata `{ repository, number }`
 * - github_check: same; posts a comment summarizing the run (Check Run API
 *   requires App auth — comment is the portable fallback for `gh` user tokens)
 */
export function createGithubDeliverySender(
  options: CreateGithubDeliverySenderOptions = {},
): DeliverySender {
  const env = options.env ?? process.env;
  const execGh =
    options.execGh ??
    ((argv, cwd) => {
      const result = spawnSync('gh', argv, {
        cwd,
        env: process.env,
        encoding: 'utf8',
        timeout: 60_000,
      });
      return {
        ok: result.status === 0,
        stderr: String(result.stderr ?? result.error?.message ?? ''),
      };
    });

  return {
    async send(input) {
      if (
        input.adapter !== 'github_comment' &&
        input.adapter !== 'github_check'
      ) {
        return {
          ok: false,
          error: `github sender cannot handle adapter=${input.adapter}`,
        };
      }
      const cwd =
        options.cwd ??
        (typeof input.target.metadata?.workspaceRoot === 'string'
          ? input.target.metadata.workspaceRoot
          : undefined) ??
        env.MITII_DELIVERY_CWD ??
        process.cwd();

      const ref = parseGithubTarget(input.target.target, input.target.metadata);
      if (!ref) {
        return {
          ok: false,
          error:
            'github delivery target must be owner/repo#number (or metadata.repository + metadata.number)',
        };
      }

      const body = formatDeliveryMessage({
        ...input,
        title:
          input.adapter === 'github_check'
            ? `[check] ${input.title}`
            : input.title,
      });

      const argv = [
        'pr',
        'comment',
        String(ref.number),
        '--repo',
        ref.repository,
        '--body',
        body,
      ];
      // Prefer PR comment; if target is an issue number, fall back to issue comment.
      let result = execGh(argv, cwd);
      if (!result.ok) {
        result = execGh(
          [
            'issue',
            'comment',
            String(ref.number),
            '--repo',
            ref.repository,
            '--body',
            body,
          ],
          cwd,
        );
      }
      if (!result.ok) {
        return {
          ok: false,
          error: result.stderr.trim() || 'gh comment failed',
        };
      }
      return { ok: true };
    },
  };
}

function parseGithubTarget(
  target: string,
  metadata?: Record<string, unknown>,
): { repository: string; number: number } | undefined {
  const fromMetaRepo =
    typeof metadata?.repository === 'string' ? metadata.repository : undefined;
  const fromMetaNum =
    typeof metadata?.number === 'number'
      ? metadata.number
      : typeof metadata?.number === 'string'
        ? Number(metadata.number)
        : undefined;
  if (fromMetaRepo && Number.isFinite(fromMetaNum)) {
    return { repository: fromMetaRepo, number: Number(fromMetaNum) };
  }
  const match = /^([^/\s]+\/[^#\s]+)#(\d+)$/.exec(target.trim());
  if (!match) return undefined;
  return { repository: match[1]!, number: Number(match[2]) };
}
