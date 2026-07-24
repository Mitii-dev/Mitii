import type { RepoMapDataSourceErrorOptions } from "../types";

export type {
  RepoMapDataSource,
  RepoMapDataSourceContext,
  RepoMapDataSourceOperation,
  RepoMapFileQuery,
  RepoMapFileQueryResult,
} from "../types";

export class RepoMapDataSourceError extends Error {
  public readonly operation: RepoMapDataSourceErrorOptions["operation"];

  public readonly dataSourceId: string;

  public override readonly cause?: unknown;

  constructor(message: string, options: RepoMapDataSourceErrorOptions) {
    super(message);

    this.name = "RepoMapDataSourceError";

    this.operation = options.operation;

    this.dataSourceId = options.dataSourceId;

    this.cause = options.cause;
  }
}

export function throwIfRepoMapAborted(abortSignal?: AbortSignal): void {
  if (!abortSignal?.aborted) {
    return;
  }

  throw new DOMException("Repo Map operation was cancelled.", "AbortError");
}
