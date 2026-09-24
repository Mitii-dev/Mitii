/**
 * Deterministic pre-agent steps for desktop automation runs.
 * Host-side only — @mitii/automation stays SDK-free.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AutomationStepResult } from '@mitii/automation';

import type { FlowStepConfig } from '../../shared/automations/flow.js';
import { getIndexStatus, reindexWorkspace } from '../index-status.js';
import { getGitStatus } from '../git/status.js';

const FORBIDDEN_COMMAND_HEADS = new Set([
  'rm',
  'sudo',
  'chmod',
  'chown',
  'mkfs',
  'dd',
  'shutdown',
  'reboot',
  'kill',
  'killall',
]);

export function parseStepsFromMetadata(
  metadataJson: string | null | undefined,
): FlowStepConfig[] {
  if (!metadataJson?.trim()) return [];
  try {
    const meta = JSON.parse(metadataJson) as {
      desktopFlow?: { steps?: unknown };
    };
    const raw = meta.desktopFlow?.steps;
    if (!Array.isArray(raw)) return [];
    return raw as FlowStepConfig[];
  } catch {
    return [];
  }
}

export async function runDeterministicSteps(input: {
  workspaceRoot: string;
  steps: FlowStepConfig[];
  onStep?: (event: {
    id: string;
    kind: string;
    phase: 'start' | 'done' | 'failed';
    summary?: string;
    error?: string;
  }) => void;
}): Promise<{
  results: AutomationStepResult[];
  promptAppendix: string;
  failed: boolean;
  error?: string;
}> {
  const results: AutomationStepResult[] = [];
  const appendixParts: string[] = [];

  for (const step of input.steps) {
    const started = Date.now();
    input.onStep?.({ id: step.id, kind: step.kind, phase: 'start' });
    try {
      if (step.kind === 'index') {
        const before = getIndexStatus(input.workspaceRoot);
        const result = await reindexWorkspace({
          workspaceRoot: input.workspaceRoot,
        });
        const summary = result.message || `Indexed ${result.fileCount} files`;
        results.push({
          id: step.id,
          kind: 'index',
          status: 'done',
          summary,
          durationMs: Date.now() - started,
        });
        appendixParts.push(
          `### Step index (${step.label ?? step.id})`,
          `- before: ${before.message}`,
          `- after: ${summary}`,
          '',
        );
        continue;
      }

      if (step.kind === 'review') {
        const status = await getGitStatus(input.workspaceRoot);
        const focus =
          step.paths && step.paths.length > 0
            ? step.paths.join(', ')
            : '(working tree)';
        const summary = `Review context prepared for ${focus}; dirty=${status.files.length}`;
        results.push({
          id: step.id,
          kind: 'review',
          status: 'done',
          summary,
          durationMs: Date.now() - started,
        });
        const fileLines = status.files
          .slice(0, 40)
          .map((f) => `- ${f.status} ${f.path}`)
          .join('\n');
        appendixParts.push(
          `### Step review (${step.label ?? step.id})`,
          `- focus: ${focus}`,
          `- branch: ${status.branch ?? 'unknown'}`,
          `- dirty files: ${status.files.length}`,
          fileLines ? `\nFiles:\n${fileLines}` : '',
          status.statPreview
            ? `\nDiff preview:\n\`\`\`\n${status.statPreview.slice(0, 4_000)}\n\`\`\``
            : '',
          '',
          'Produce line-anchored findings where possible. Prefer structured review.',
          '',
        );
        continue;
      }

      if (step.kind === 'command') {
        const argv = step.argv.map((a) => a.trim()).filter(Boolean);
        if (argv.length === 0) {
          results.push({
            id: step.id,
            kind: 'command',
            status: 'skipped',
            summary: 'empty argv',
            durationMs: Date.now() - started,
          });
          continue;
        }
        const head = argv[0]!.toLowerCase();
        if (FORBIDDEN_COMMAND_HEADS.has(head) || head.includes('/') && head.endsWith('rm')) {
          const error = `Command head "${argv[0]}" is blocked by desktop automation policy`;
          results.push({
            id: step.id,
            kind: 'command',
            status: 'failed',
            error,
            durationMs: Date.now() - started,
          });
          if (step.failOnError !== false) {
            return {
              results,
              promptAppendix: appendixParts.join('\n'),
              failed: true,
              error,
            };
          }
          continue;
        }
        const exec = await runArgvCommand({
          cwd: input.workspaceRoot,
          argv,
          timeoutSeconds: step.timeoutSeconds ?? 600,
        });
        const summary = `exit ${exec.code}; stdout ${exec.stdout.length}b stderr ${exec.stderr.length}b`;
        const passOutput = step.passOutput !== false;
        if (exec.code !== 0) {
          results.push({
            id: step.id,
            kind: 'command',
            status: 'failed',
            summary,
            error: exec.stderr.slice(0, 2_000) || `exit_${exec.code}`,
            durationMs: Date.now() - started,
          });
          if (passOutput) {
            appendixParts.push(
              `### Command output (${step.label ?? step.id})`,
              `- argv: \`${argv.join(' ')}\``,
              `- exit: ${exec.code}`,
              '```',
              exec.stderr.slice(0, 3_000) || exec.stdout.slice(0, 3_000),
              '```',
              '',
            );
          }
          if (step.failOnError !== false) {
            return {
              results,
              promptAppendix: appendixParts.join('\n'),
              failed: true,
              error: exec.stderr.slice(0, 500) || `command_exit_${exec.code}`,
            };
          }
        } else {
          results.push({
            id: step.id,
            kind: 'command',
            status: 'done',
            summary,
            durationMs: Date.now() - started,
          });
          if (passOutput) {
            appendixParts.push(
              `### Command output (${step.label ?? step.id})`,
              `- argv: \`${argv.join(' ')}\``,
              `- exit: 0`,
              exec.stdout.trim()
                ? `\`\`\`\n${exec.stdout.slice(0, 3_000)}\n\`\`\``
                : '_no stdout_',
              '',
            );
          }
        }
        continue;
      }

      if (step.kind === 'recipe') {
        const recipeId = step.recipeId.trim();
        const summary = recipeId
          ? `Recipe “${recipeId}” attached for agent context`
          : 'Recipe step has no recipeId configured';
        results.push({
          id: step.id,
          kind: 'recipe',
          status: recipeId ? 'done' : 'skipped',
          summary,
          durationMs: Date.now() - started,
        });
        appendixParts.push(
          `### Step recipe (${step.label ?? step.id})`,
          `- recipeId: ${recipeId || '(unset)'}`,
          'Follow the named Mitii recipe / playbook when applicable.',
          '',
        );
        continue;
      }

      if (step.kind === 'mcp') {
        const serverId = step.serverId.trim();
        const summary = serverId
          ? `MCP “${step.label ?? serverId}” attached`
          : 'MCP node has no server';
        results.push({
          id: step.id,
          kind: 'mcp',
          status: serverId ? 'done' : 'skipped',
          summary,
          durationMs: Date.now() - started,
        });
        appendixParts.push(
          `### MCP (${step.label ?? step.id})`,
          `- server: ${serverId || '(unset)'}`,
          'Use this MCP server when fulfilling the run.',
          '',
        );
        continue;
      }

      if (step.kind === 'skill') {
        const skillId = step.skillId.trim();
        const summary = skillId
          ? `Skill “${step.label ?? skillId}” attached`
          : 'Skill node has no skill id';
        results.push({
          id: step.id,
          kind: 'skill',
          status: skillId ? 'done' : 'skipped',
          summary,
          durationMs: Date.now() - started,
        });
        appendixParts.push(
          `### Skill (${step.label ?? step.id})`,
          `- skillId: ${skillId || '(unset)'}`,
          'Follow this skill when fulfilling the run.',
          '',
        );
        continue;
      }

      if (step.kind === 'hook') {
        const summary = `Hook ${step.hookKind}${step.hookId ? ` (${step.hookId})` : ''} noted`;
        results.push({
          id: step.id,
          kind: 'hook',
          status: 'done',
          summary,
          durationMs: Date.now() - started,
        });
        appendixParts.push(
          `### Step hook (${step.label ?? step.id})`,
          `- hookKind: ${step.hookKind}`,
          step.hookId ? `- hookId: ${step.hookId}` : '',
          '',
        );
        continue;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        id: step.id,
        kind: step.kind,
        status: 'failed',
        error: message,
        durationMs: Date.now() - started,
      });
      const failOnError =
        step.kind === 'command' ? step.failOnError !== false : true;
      if (failOnError) {
        input.onStep?.({
          id: step.id,
          kind: step.kind,
          phase: 'failed',
          error: message,
        });
        return {
          results,
          promptAppendix: appendixParts.join('\n'),
          failed: true,
          error: message,
        };
      }
    }
    const last = results[results.length - 1];
    if (last && last.id === step.id && last.status !== 'failed') {
      input.onStep?.({
        id: step.id,
        kind: step.kind,
        phase: last.status === 'skipped' ? 'done' : 'done',
        summary: last.summary,
        error: last.error,
      });
    }
  }

  return {
    results,
    promptAppendix: appendixParts.join('\n'),
    failed: false,
  };
}

function runArgvCommand(input: {
  cwd: string;
  argv: string[];
  timeoutSeconds: number;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.argv[0]!, input.argv.slice(1), {
      cwd: input.cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`command_timeout_${input.timeoutSeconds}s`));
    }, Math.max(1, input.timeoutSeconds) * 1000);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Read a report file if present (run inspector). */
export function readReportFile(reportPath: string | null | undefined): string | null {
  if (!reportPath?.trim()) return null;
  try {
    return readFileSync(reportPath, 'utf8');
  } catch {
    return null;
  }
}

export function artifactDirHint(dbPath: string, runId: string): string {
  return join(dbPath, '..', 'artifacts', runId);
}
