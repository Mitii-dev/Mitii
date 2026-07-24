import { ContentHasher } from "../../../shared";
import type {
  WorkspaceEntry,
  WorkspaceRoot,
  WorkspaceSnapshotStatus,
} from "../../types";

export interface WorkspaceSnapshotIdInput {
  roots: readonly WorkspaceRoot[];
  entries: readonly WorkspaceEntry[];
  status: WorkspaceSnapshotStatus;
}

export class WorkspaceSnapshotIdBuilder {
  constructor(private readonly hasher: ContentHasher = new ContentHasher()) {}

  public build(input: WorkspaceSnapshotIdInput): string {
    const values: string[] = ["workspace-snapshot-v1", input.status];

    const roots = [...input.roots].sort((left, right) =>
      left.id.localeCompare(right.id),
    );

    for (const root of roots) {
      values.push(
        "root",
        root.id,
        root.name,
        root.kind,
        root.providerPath ?? "",
      );
    }

    const entries = [...input.entries].sort((left, right) => {
      const rootComparison = left.rootId.localeCompare(right.rootId);

      if (rootComparison !== 0) {
        return rootComparison;
      }

      return left.relativePath.localeCompare(right.relativePath);
    });

    for (const entry of entries) {
      values.push(
        "entry",
        entry.rootId,
        entry.relativePath,
        entry.kind,
        String(entry.depth),
      );

      if (entry.kind === "file") {
        values.push(
          String(entry.size ?? 0),
          entry.modifiedAt ?? "",
          entry.contentHash ?? "",
        );
      }

      if (entry.kind === "symbolic_link") {
        values.push(entry.linkTarget ?? "");
      }
    }

    return this.hasher.hashValues(values);
  }
}
