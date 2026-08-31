import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { redactSecrets } from '../security/redact.js';

/**
 * Phase 4 — pull CI logs and build an evidence pack directory for triage.
 */

export interface PullCiLogsInput {
  /** GitHub Actions run id */
  runId: string | number;
  repository?: string;
  workspaceRoot: string;
  outDir: string;
  env?: NodeJS.ProcessEnv;
}

export interface PullCiLogsResult {
  ok: boolean;
  logPath?: string;
  error?: string;
}

export function pullGithubActionsLogs(
  input: PullCiLogsInput,
): PullCiLogsResult {
  mkdirSync(input.outDir, { recursive: true });
  const logPath = join(input.outDir, `workflow-run-${input.runId}.log`);
  const argv = ['run', 'view', String(input.runId), '--log'];
  if (input.repository) {
    argv.push('--repo', input.repository);
  }
  const result = spawnSync('gh', argv, {
    cwd: input.workspaceRoot,
    env: input.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      error: String(result.stderr || result.error?.message || 'gh run view failed'),
    };
  }
  writeFileSync(logPath, redactSecrets(result.stdout ?? '').text, 'utf8');
  return { ok: true, logPath };
}

export interface EvidencePackInput {
  outDir: string;
  title: string;
  fingerprint: string;
  summary: string;
  eventJson?: string | null;
  logPaths?: string[];
  reportPath?: string | null;
}

export interface EvidencePackResult {
  dir: string;
  manifestPath: string;
  fingerprint: string;
}

/**
 * Write a durable evidence pack used by incident triage + ticket bodies.
 */
export function writeEvidencePack(
  input: EvidencePackInput,
): EvidencePackResult {
  mkdirSync(input.outDir, { recursive: true });
  if (input.eventJson) {
    writeFileSync(
      join(input.outDir, 'event.json'),
      redactSecrets(input.eventJson).text,
      'utf8',
    );
  }
  writeFileSync(
    join(input.outDir, 'summary.md'),
    redactSecrets(input.summary).text,
    'utf8',
  );
  const files = ['summary.md'];
  if (input.eventJson) files.push('event.json');
  for (const log of input.logPaths ?? []) {
    // referenced only — packRunArtifacts copies separately when passed as extraFiles
    files.push(log);
  }
  if (input.reportPath) files.push(input.reportPath);

  const manifest = {
    title: input.title,
    fingerprint: input.fingerprint,
    files,
    packedAt: new Date().toISOString(),
  };
  const manifestPath = join(input.outDir, 'evidence-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    dir: input.outDir,
    manifestPath,
    fingerprint: input.fingerprint,
  };
}

/**
 * Stable incident fingerprint for idempotent GitHub issues.
 */
export function buildIncidentFingerprint(parts: string[]): string {
  const joined = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join('|');
  return createHash('sha256').update(joined).digest('hex').slice(0, 16);
}

/**
 * Title template: keeps fingerprint prefix so re-opens can be searched.
 */
export function formatIncidentIssueTitle(input: {
  fingerprint: string;
  workflowName?: string;
  repository?: string;
  conclusion?: string;
}): string {
  const bits = [
    `[mitii:${input.fingerprint}]`,
    input.repository,
    input.workflowName ?? 'CI failure',
    input.conclusion,
  ].filter(Boolean);
  return bits.join(' — ').slice(0, 240);
}

export function formatIncidentIssueBody(input: {
  fingerprint: string;
  summary: string;
  evidenceDir?: string;
  eventType?: string;
  runUrl?: string;
}): string {
  const summary = redactSecrets(input.summary).text;
  return `## Mitii incident triage

**Fingerprint:** \`${input.fingerprint}\`
**Event:** ${input.eventType ?? 'n/a'}
${input.runUrl ? `**Run:** ${input.runUrl}` : ''}

### Summary

${summary}

${input.evidenceDir ? `### Evidence\n\nLocal pack: \`${input.evidenceDir}\`` : ''}

---
_Idempotent key: mitii-fingerprint:${input.fingerprint}_
`;
}
