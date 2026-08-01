import type {
  FileSystemReadPort,
} from "../shared";

import {
  resolveSourceFileReaderOptions,
} from "./constants";

import {
  SourceFileReadError,
} from "./SourceFileReadError";

import type {
  SourceFileContent,
  SourceFileReaderInput,
  SourceFileReaderOptions,
} from "./types";

export class SourceFileReader {
  private readonly options:
    Required<SourceFileReaderOptions>;

  constructor(
    private readonly fileSystem:
      FileSystemReadPort,
    options:
      SourceFileReaderOptions = {},
  ) {
    this.options =
      resolveSourceFileReaderOptions(
        options,
      );

    this.validateOptions();
  }

  public async read(
    input: SourceFileReaderInput,
  ): Promise<SourceFileContent> {
    if (input.file.kind !== "file") {
      throw new SourceFileReadError(
        "not_a_file",
        input.file.relativePath,
        `Source analysis can only read file entries: "${input.file.relativePath}".`,
      );
    }

    const providerPath =
      input.file.providerPath;

    if (!providerPath) {
      throw new SourceFileReadError(
        "provider_path_missing",
        input.file.relativePath,
        `Workspace file "${input.file.relativePath}" does not have a providerPath.`,
      );
    }

    let content: string;

    try {
      content =
        await this.fileSystem.readText(
          providerPath,
          {
            encoding: "utf8",
            maximumBytes:
              this.options
                .maximumBytes,
          },
        );
    } catch (error) {
      throw new SourceFileReadError(
        "read_failed",
        providerPath,
        `Unable to read source file "${input.file.relativePath}".`,
        {
          cause: error,
        },
      );
    }

    return {
      sourceId:
        input.sourceId,
      rootId:
        input.file.rootId,
      relativePath:
        input.file.relativePath,
      providerPath,
      content,
      byteLength:
        new TextEncoder()
          .encode(content)
          .byteLength,
    };
  }

  private validateOptions(): void {
    if (
      !Number.isSafeInteger(
        this.options.maximumBytes,
      ) ||
      this.options.maximumBytes <= 0
    ) {
      throw new RangeError(
        "maximumBytes must be a positive safe integer.",
      );
    }
  }
}

