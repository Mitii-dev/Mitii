import type { ToolReasonCode } from "../../contracts";

export class MutationError extends Error {
  public readonly reasonCode: ToolReasonCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    reasonCode: ToolReasonCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MutationError";
    this.reasonCode = reasonCode;
    this.details = details;
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
  /** When true, replace every exact oldText occurrence. Default is unique match. */
  replaceAll?: boolean;
}

export interface AppliedPatchRecord {
  path: string;
  created: boolean;
  bytesWritten: number;
}
