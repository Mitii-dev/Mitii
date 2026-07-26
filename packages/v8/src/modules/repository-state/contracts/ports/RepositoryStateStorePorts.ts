import type { RepositoryStateDescriptor } from "../output/RepositoryStateDescriptor";
import type { RepositoryStateReference } from "../output/RepositoryStateReference";

/**
 * Immutable publication store for repository state descriptors.
 */
export interface RepositoryStatePublisherPort {
  /**
   * Atomically publish a descriptor. Must not mutate an existing token.
   * Idempotent when the same token + identical descriptor is republished.
   */
  publish(
    descriptor: RepositoryStateDescriptor,
  ): Promise<void>;
}

export interface RepositoryStateReaderPort {
  read(
    reference: RepositoryStateReference,
  ): Promise<RepositoryStateDescriptor | undefined>;

  /**
   * Latest published descriptor for a workspace, if any.
   * Used by new runs; active runs must use their pinned reference.
   */
  getLatest(
    workspaceId: string,
  ): Promise<RepositoryStateDescriptor | undefined>;
}

/**
 * Retains published states needed by active runs and checkpoints.
 */
export interface ActiveRunStateRetentionPort {
  pin(
    reference: RepositoryStateReference,
    runId: string,
  ): Promise<void>;

  unpin(
    reference: RepositoryStateReference,
    runId: string,
  ): Promise<void>;

  listPinnedRunIds(
    reference: RepositoryStateReference,
  ): Promise<readonly string[]>;

  /**
   * Returns false when any active run still pins the token.
   */
  canDelete(
    reference: RepositoryStateReference,
  ): Promise<boolean>;
}

export interface RepositoryStateStorePort
  extends RepositoryStatePublisherPort,
    RepositoryStateReaderPort,
    ActiveRunStateRetentionPort {}
