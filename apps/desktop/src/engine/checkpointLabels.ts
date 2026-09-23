/**
 * UI checkpoint labels for Mitii Desktop (VS Code `mitii.checkpoints.v1` parity).
 * Separate from engine RestorePoints under `.mitii/checkpoints/`.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface CheckpointItemView {
  id: string;
  label: string;
  createdAt: string;
  changedPaths?: string[];
}

const LABELS_FILE = 'ui-labels.json';
const STORAGE_VERSION = 1 as const;
const MAX_LABELS = 30;

interface LabelsEnvelope {
  storageVersion: typeof STORAGE_VERSION;
  checkpoints: CheckpointItemView[];
}

function labelsPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'checkpoints', LABELS_FILE);
}

async function readEnvelope(
  workspaceRoot: string,
): Promise<LabelsEnvelope> {
  try {
    const raw = await readFile(labelsPath(workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw) as LabelsEnvelope;
    if (
      !parsed ||
      parsed.storageVersion !== STORAGE_VERSION ||
      !Array.isArray(parsed.checkpoints)
    ) {
      return { storageVersion: STORAGE_VERSION, checkpoints: [] };
    }
    return {
      storageVersion: STORAGE_VERSION,
      checkpoints: parsed.checkpoints.filter(
        (item): item is CheckpointItemView =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.id === 'string' &&
          typeof item.label === 'string' &&
          typeof item.createdAt === 'string',
      ),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { storageVersion: STORAGE_VERSION, checkpoints: [] };
    }
    return { storageVersion: STORAGE_VERSION, checkpoints: [] };
  }
}

async function writeEnvelope(
  workspaceRoot: string,
  envelope: LabelsEnvelope,
): Promise<void> {
  const filePath = labelsPath(workspaceRoot);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(
      tempPath,
      `${JSON.stringify(envelope, null, 2)}\n`,
      'utf8',
    );
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export async function loadCheckpointLabels(
  workspaceRoot: string,
): Promise<CheckpointItemView[]> {
  const envelope = await readEnvelope(workspaceRoot);
  return envelope.checkpoints;
}

export async function saveCheckpointLabels(
  workspaceRoot: string,
  checkpoints: CheckpointItemView[],
): Promise<CheckpointItemView[]> {
  const next = checkpoints.slice(0, MAX_LABELS);
  await writeEnvelope(workspaceRoot, {
    storageVersion: STORAGE_VERSION,
    checkpoints: next,
  });
  return next;
}

export async function recordCheckpointLabel(input: {
  workspaceRoot: string;
  label: string;
  changedPaths?: string[];
}): Promise<CheckpointItemView[]> {
  const existing = await loadCheckpointLabels(input.workspaceRoot);
  const item: CheckpointItemView = {
    id: `cp_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`,
    label: input.label.slice(0, 120),
    createdAt: new Date().toISOString(),
    ...(input.changedPaths && input.changedPaths.length > 0
      ? { changedPaths: input.changedPaths }
      : {}),
  };
  return saveCheckpointLabels(input.workspaceRoot, [item, ...existing]);
}

export async function deleteCheckpointLabel(input: {
  workspaceRoot: string;
  id: string;
}): Promise<CheckpointItemView[]> {
  const existing = await loadCheckpointLabels(input.workspaceRoot);
  return saveCheckpointLabels(
    input.workspaceRoot,
    existing.filter((item) => item.id !== input.id),
  );
}

export async function clearCheckpointLabels(
  workspaceRoot: string,
): Promise<void> {
  await saveCheckpointLabels(workspaceRoot, []);
}
