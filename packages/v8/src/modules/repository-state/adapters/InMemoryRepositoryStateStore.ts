import { RepositoryStateError } from "../contracts/errors/RepositoryStateError";
import type { RepositoryStateDescriptor } from "../contracts/output/RepositoryStateDescriptor";
import type { RepositoryStateReference } from "../contracts/output/RepositoryStateReference";
import type { RepositoryStateStorePort } from "../contracts/ports/RepositoryStateStorePorts";

function referenceKey(reference: RepositoryStateReference): string {
  return `${reference.workspaceId}::${reference.stateToken}`;
}

function descriptorsEqual(
  left: RepositoryStateDescriptor,
  right: RepositoryStateDescriptor,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * In-memory Repository State store for tests and headless hosts.
 * Published descriptors are immutable; pins retain tokens for active runs.
 */
export class InMemoryRepositoryStateStore
  implements RepositoryStateStorePort
{
  private readonly byToken = new Map<string, RepositoryStateDescriptor>();
  private readonly latestByWorkspace = new Map<string, string>();
  private readonly pins = new Map<string, Set<string>>();
  private publishGate: Promise<void> = Promise.resolve();

  public async publish(
    descriptor: RepositoryStateDescriptor,
  ): Promise<void> {
    const run = async (): Promise<void> => {
      const key = referenceKey({
        workspaceId: descriptor.workspaceId,
        stateToken: descriptor.stateToken,
      });
      const existing = this.byToken.get(key);

      if (existing) {
        if (!descriptorsEqual(existing, descriptor)) {
          throw new RepositoryStateError(
            "state_immutable",
            "Published repository state tokens are immutable.",
            {
              workspaceId: descriptor.workspaceId,
              stateToken: descriptor.stateToken,
            },
          );
        }
        return;
      }

      this.byToken.set(key, Object.freeze({
        ...descriptor,
        roots: descriptor.roots.map((root) =>
          Object.freeze({
            ...root,
            capabilities: Object.freeze([...root.capabilities]),
          }),
        ),
        reasons: Object.freeze([...descriptor.reasons]),
      }) as RepositoryStateDescriptor);
      this.latestByWorkspace.set(
        descriptor.workspaceId,
        descriptor.stateToken,
      );
    };

    const previous = this.publishGate;
    let release!: () => void;
    this.publishGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      await run();
    } finally {
      release();
    }
  }

  public async read(
    reference: RepositoryStateReference,
  ): Promise<RepositoryStateDescriptor | undefined> {
    return this.byToken.get(referenceKey(reference));
  }

  public async getLatest(
    workspaceId: string,
  ): Promise<RepositoryStateDescriptor | undefined> {
    const token = this.latestByWorkspace.get(workspaceId);
    if (!token) {
      return undefined;
    }
    return this.byToken.get(referenceKey({ workspaceId, stateToken: token }));
  }

  public async pin(
    reference: RepositoryStateReference,
    runId: string,
  ): Promise<void> {
    const key = referenceKey(reference);
    if (!this.byToken.has(key)) {
      throw new RepositoryStateError(
        "unknown_state_token",
        "Cannot pin an unpublished repository state token.",
        { ...reference, runId },
      );
    }

    const runs = this.pins.get(key) ?? new Set<string>();
    runs.add(runId);
    this.pins.set(key, runs);
  }

  public async unpin(
    reference: RepositoryStateReference,
    runId: string,
  ): Promise<void> {
    const key = referenceKey(reference);
    const runs = this.pins.get(key);
    if (!runs || !runs.has(runId)) {
      throw new RepositoryStateError(
        "state_not_found",
        "No pin exists for the given run and state token.",
        { ...reference, runId },
      );
    }

    runs.delete(runId);
    if (runs.size === 0) {
      this.pins.delete(key);
    }
  }

  public async listPinnedRunIds(
    reference: RepositoryStateReference,
  ): Promise<readonly string[]> {
    const runs = this.pins.get(referenceKey(reference));
    return runs ? [...runs].sort() : [];
  }

  public async canDelete(
    reference: RepositoryStateReference,
  ): Promise<boolean> {
    const runs = this.pins.get(referenceKey(reference));
    return !runs || runs.size === 0;
  }

  /**
   * Test/helper: attempt retention cleanup. Refuses when pinned.
   */
  public async deleteIfUnpinned(
    reference: RepositoryStateReference,
  ): Promise<boolean> {
    if (!(await this.canDelete(reference))) {
      throw new RepositoryStateError(
        "state_pinned",
        "Cannot delete a repository state pinned by an active run.",
        { ...reference },
      );
    }

    const key = referenceKey(reference);
    const removed = this.byToken.delete(key);
    const latest = this.latestByWorkspace.get(reference.workspaceId);
    if (latest === reference.stateToken) {
      this.latestByWorkspace.delete(reference.workspaceId);
    }
    return removed;
  }
}
