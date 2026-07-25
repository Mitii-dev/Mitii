import type {
  ContextAssemblyErrorOptions,
} from "./types";

export class ContextAssemblyError
  extends Error
{
  public readonly operation:
    ContextAssemblyErrorOptions[
      "operation"
    ];

  public readonly componentId:
    string;

  public override readonly cause?:
    unknown;

  public constructor(
    message: string,
    options:
      ContextAssemblyErrorOptions,
  ) {
    super(message);

    this.name =
      "ContextAssemblyError";
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
