import {
  copyFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

import { resolveAutomationReportsDir } from '../paths.js';
import type { AutomationRunRecord, AutomationSpecRecord } from '../types.js';

export interface PackArtifactsInput {
  run: AutomationRunRecord;
  spec: AutomationSpecRecord;
  dbPath: string;
  /** Extra files to copy into the pack (e.g. CI logs). */
  extraFiles?: string[];
  answer?: string | null;
  error?: string | null;
}

export interface ArtifactPack {
  dir: string;
  manifestPath: string;
  files: string[];
}

/**
 * Pack run report + optional evidence into
 * `~/.mitii/automation/artifacts/<runId>/`.
 */
export function packRunArtifacts(input: PackArtifactsInput): ArtifactPack {
  const reportsDir = resolveAutomationReportsDir(input.dbPath);
  const artifactsRoot = join(reportsDir, '..', 'artifacts');
  const dir = join(artifactsRoot, input.run.runId);
  mkdirSync(dir, { recursive: true });

  const files: string[] = [];
  if (input.run.reportPath && existsSync(input.run.reportPath)) {
    const dest = join(dir, 'report.md');
    copyFileSync(input.run.reportPath, dest);
    files.push(dest);
  }

  for (const extra of input.extraFiles ?? []) {
    if (!existsSync(extra)) continue;
    const dest = join(dir, basename(extra));
    copyFileSync(extra, dest);
    files.push(dest);
  }

  const manifest = {
    runId: input.run.runId,
    specId: input.spec.specId,
    title: input.spec.title,
    status: input.run.status,
    triggerKind: input.run.triggerKind,
    triggerEventId: input.run.triggerEventId,
    sessionId: input.run.sessionId,
    answer: input.answer ?? null,
    error: input.error ?? input.run.error,
    files: files.map((f) => basename(f)),
    packedAt: new Date().toISOString(),
  };
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  files.push(manifestPath);

  return { dir, manifestPath, files };
}
