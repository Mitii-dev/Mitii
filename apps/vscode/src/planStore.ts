import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanArtifact } from '@mitii/sdk';
import { serializePlanText } from '@mitii/v8';

import { mitiiPlansDir } from './mitiiWorkspace.js';

export const PLAN_STORE_DIR = 'plans' as const;

export interface SavedPlanRecord {
  schemaVersion: 1;
  savedAt: string;
  source: 'plan_mode' | 'plan_approval' | 'agent';
  threadId?: string;
  plan: PlanArtifact;
}

export interface SavePlanOptions {
  workspaceRoot: string;
  plan: PlanArtifact;
  source: SavedPlanRecord['source'];
  threadId?: string;
  /** Injected clock for tests. */
  now?: Date;
}

export interface SavePlanResult {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  markdownPath: string;
  savedAt: string;
}

/**
 * Build a filesystem-safe plan basename:
 * `YYYYMMDD-HHMMSS-<slug>.json`
 */
export function buildPlanFileBaseName(options: {
  plan: PlanArtifact;
  now?: Date;
}): string {
  const stamp = formatTimestamp(options.now ?? new Date());
  const slug = slugifyObjective(options.plan.objective);
  return `${stamp}-${slug}`;
}

/**
 * Persist a plan under `.mitii/plans/` as JSON (+ companion markdown).
 */
export function savePlanToWorkspace(options: SavePlanOptions): SavePlanResult {
  const root = options.workspaceRoot.trim();
  if (!root) {
    throw new Error('workspaceRoot is required to save a plan');
  }

  const now = options.now ?? new Date();
  const savedAt = now.toISOString();
  const plansDir = mitiiPlansDir(root);
  mkdirSync(plansDir, { recursive: true });

  const baseName = buildPlanFileBaseName({ plan: options.plan, now });
  const jsonName = `${baseName}.json`;
  const mdName = `${baseName}.md`;
  const absolutePath = join(plansDir, jsonName);
  const markdownPath = join(plansDir, mdName);

  const record: SavedPlanRecord = {
    schemaVersion: 1,
    savedAt,
    source: options.source,
    threadId: options.threadId,
    plan: options.plan,
  };

  writeFileSync(absolutePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  writeFileSync(
    markdownPath,
    [
      `# ${options.plan.objective}`,
      '',
      `- Saved: ${savedAt}`,
      `- Source: ${options.source}`,
      options.threadId ? `- Thread: ${options.threadId}` : undefined,
      '',
      serializePlanText(options.plan),
      '',
    ]
      .filter((line) => line !== undefined)
      .join('\n'),
    'utf8',
  );

  return {
    absolutePath,
    relativePath: join('.mitii', PLAN_STORE_DIR, jsonName),
    fileName: jsonName,
    markdownPath,
    savedAt,
  };
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

function slugifyObjective(objective: string): string {
  const slug = objective
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'plan';
}
