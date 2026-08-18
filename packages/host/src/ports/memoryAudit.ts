import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface MemoryAuditEvent {
  at: string;
  action: 'delete' | 'clear' | 'evict' | 'observe' | 'promote';
  reason: string;
  memoryIds?: readonly string[];
  workspaceId: string;
}

export async function appendMemoryAudit(
  workspaceRoot: string,
  event: MemoryAuditEvent,
): Promise<void> {
  const filePath = join(workspaceRoot, '.mitii', 'memory', 'audit.jsonl');
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
}
