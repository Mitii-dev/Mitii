import {
  VECTOR_INDEX_MESSAGES,
} from "./constants";

import type {
  VectorIndexErrorOptions,
  VectorIndexOperation,
  VectorIndexProfileMismatchDetails,
  VectorIndexRevisionMismatchDetails,
} from "./types";

export class VectorIndexError
  extends Error
{
  public readonly operation:
    VectorIndexOperation;

  public readonly componentId:
    string;

  public override readonly cause?:
    unknown;

  constructor(
    message: string,
    options: VectorIndexErrorOptions,
  ) {
    super(message);

    this.name =
      "VectorIndexError";
    this.operation =
      options.operation;
    this.componentId =
      options.componentId;

    if (
      options.cause !==
      undefined
    ) {
      this.cause =
        options.cause;
    }
  }
}

export class VectorIndexRevisionMismatchError
  extends VectorIndexError
{
  public readonly expectedTextRevision:
    number;

  public readonly actualTextRevision:
    number;

  constructor(
    details:
      VectorIndexRevisionMismatchDetails,
    options: VectorIndexErrorOptions,
  ) {
    super(
      VECTOR_INDEX_MESSAGES
        .REVISION_MISMATCH,
      options,
    );

    this.name =
      "VectorIndexRevisionMismatchError";
    this.expectedTextRevision =
      details.expectedTextRevision;
    this.actualTextRevision =
      details.actualTextRevision;
  }
}

export class VectorIndexProfileMismatchError
  extends VectorIndexError
{
  public readonly expectedProfileId:
    string;

  public readonly actualProfileId:
    string;

  constructor(
    details:
      VectorIndexProfileMismatchDetails,
    options: VectorIndexErrorOptions,
  ) {
    super(
      VECTOR_INDEX_MESSAGES
        .TABLE_PROFILE_MISMATCH,
      options,
    );

    this.name =
      "VectorIndexProfileMismatchError";
    this.expectedProfileId =
      details.expectedProfileId;
    this.actualProfileId =
      details.actualProfileId;
  }
}

export function throwIfVectorIndexAborted(
  signal: AbortSignal | undefined,
  operation:
    VectorIndexOperation,
  componentId: string,
): void {
  if (!signal?.aborted) {
    return;
  }

  throw new VectorIndexError(
    VECTOR_INDEX_MESSAGES.CANCELLED,
    {
      operation,
      componentId,
      cause:
        signal.reason,
    },
  );
}
