export class FileSizeLimitExceededError extends Error {
  public readonly path: string;
  public readonly maximumBytes: number;

  constructor(targetPath: string, maximumBytes: number) {
    super(
      `File "${targetPath}" exceeds the maximum read size of ` +
        `${maximumBytes} bytes.`,
    );

    this.name = "FileSizeLimitExceededError";
    this.path = targetPath;
    this.maximumBytes = maximumBytes;
  }
}

export class UnsupportedFileSystemOperationError extends Error {
  public readonly operation: string;

  constructor(operation: string, adapterName: string) {
    super(
      `${adapterName} does not support the ` +
        `"${operation}" filesystem operation.`,
    );

    this.name = "UnsupportedFileSystemOperationError";

    this.operation = operation;
  }
}
