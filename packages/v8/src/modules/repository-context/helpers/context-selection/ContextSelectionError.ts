import type {
  ContextSelectionErrorOptions,
} from "./types";

export class ContextSelectionError
  extends Error
{
  public readonly operation:
    ContextSelectionErrorOptions[
      "operation"
    ];

  public readonly componentId:
    string;

  public override readonly cause?:
    unknown;

  public constructor(
    message: string,
    options:
      ContextSelectionErrorOptions,
  ) {
    super(message);

    this.name =
      "ContextSelectionError";
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
