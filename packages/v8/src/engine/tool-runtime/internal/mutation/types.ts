import type { ToolReasonCode } from "../../contracts";

export class MutationError extends Error {
  public readonly reasonCode: ToolReasonCode;

  constructor(reasonCode: ToolReasonCode, message: string) {
    super(message);
    this.name = "MutationError";
    this.reasonCode = reasonCode;
  }
}

export type CheckpointFileSnapshot =
  | { relativePath: string; kind: "existing"; content: string }
  | { relativePath: string; kind: "missing" }
  | { relativePath: string; kind: "directory" };

export interface MutationCheckpoint {
  checkpointId: string;
  workspaceRoot: string;
  files: CheckpointFileSnapshot[];
  createdAt: string;
}

export interface StructuredPatch {
  path: string;
  oldText: string;
  newText: string;
  expectedHash?: string;
}

export interface AppliedPatchRecord {
  path: string;
  created: boolean;
  bytesWritten: number;
}
