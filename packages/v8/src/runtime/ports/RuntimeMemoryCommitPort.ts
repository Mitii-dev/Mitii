/**
 * Finish-time memory commit port (S11-MEM) — modules own persistence.
 */

export interface RuntimeMemoryCommitInput {
  content: string;
  workspaceId?: string;
  projectId?: string;
  tags?: readonly string[];
  files?: readonly string[];
  title?: string;
  runId?: string;
}

export interface RuntimeMemoryCommitResult {
  ok: boolean;
  memoryId?: string;
  reasonCodes: string[];
}

export interface RuntimeMemoryCommitPort {
  commit(input: RuntimeMemoryCommitInput): Promise<RuntimeMemoryCommitResult>;
}
