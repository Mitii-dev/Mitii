import type { ManifestReader } from "../types";
import type { WorkspaceFileEntry } from "../../workspace";

export interface ManifestReaderResolution {
  status: "resolved" | "not_found" | "ambiguous";
  reader?: ManifestReader;
  candidates: readonly ManifestReader[];
}

export class ManifestReaderRegistry {
  private readonly readers = new Map<string, ManifestReader>();

  public register(reader: ManifestReader): void {
    if (this.readers.has(reader.id)) {
      throw new Error(`Manifest reader "${reader.id}" is already registered.`);
    }

    this.readers.set(reader.id, reader);
  }

  public unregister(readerId: string): boolean {
    return this.readers.delete(readerId);
  }

  public resolve(manifest: WorkspaceFileEntry): ManifestReaderResolution {
    const candidates = [...this.readers.values()]
      .filter((reader) => reader.supports(manifest))
      .sort((left, right) => {
        const priorityComparison = right.priority - left.priority;

        if (priorityComparison !== 0) {
          return priorityComparison;
        }

        return left.id.localeCompare(right.id);
      });

    if (candidates.length === 0) {
      return {
        status: "not_found",
        candidates: [],
      };
    }

    const highestPriority = candidates[0].priority;

    const highestPriorityReaders = candidates.filter(
      (reader) => reader.priority === highestPriority,
    );

    if (highestPriorityReaders.length > 1) {
      return {
        status: "ambiguous",
        candidates: highestPriorityReaders,
      };
    }

    return {
      status: "resolved",
      reader: candidates[0],
      candidates,
    };
  }

  public list(): readonly ManifestReader[] {
    return [...this.readers.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }
}
