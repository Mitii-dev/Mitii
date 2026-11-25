import {
  CODE_INDEX_IDS,
} from "./constants";

import type {
  CodeIndexFileIdentity,
  CodeIndexFileIdentityInput,
  CodeIndexSymbolIdentityInput,
} from "./types";

export class CodeIndexIdBuilder {
  public createFileId(
    input: CodeIndexFileIdentityInput,
  ): string {
    const rootId = input.rootId.trim();
    const relativePath = this.normalizePath(
      input.relativePath,
    );

    if (!rootId || !relativePath) {
      throw new RangeError(
        "Stable file IDs require rootId and relativePath.",
      );
    }

    return [
      CODE_INDEX_IDS.FILE_PREFIX,
      encodeURIComponent(rootId),
      encodeURIComponent(relativePath),
    ].join(":");
  }

  public parseFileId(
    fileId: string,
  ): CodeIndexFileIdentity | null {
    const prefix =
      `${CODE_INDEX_IDS.FILE_PREFIX}:`;

    if (!fileId.startsWith(prefix)) {
      return null;
    }

    const remainder = fileId.slice(
      prefix.length,
    );

    const separator = remainder.indexOf(":");

    if (separator <= 0) {
      return null;
    }

    try {
      const rootId = decodeURIComponent(
        remainder.slice(0, separator),
      );

      const relativePath =
        this.normalizePath(
          decodeURIComponent(
            remainder.slice(separator + 1),
          ),
        );

      if (!rootId || !relativePath) {
        return null;
      }

      return {
        rootId,
        relativePath,
      };
    } catch {
      return null;
    }
  }

  public createSymbolId(
    input: CodeIndexSymbolIdentityInput,
  ): string {
    if (
      !input.fileId ||
      !input.kind.trim() ||
      !input.name.trim()
    ) {
      throw new RangeError(
        "Stable symbol IDs require fileId, kind and name.",
      );
    }

    return [
      CODE_INDEX_IDS.SYMBOL_PREFIX,
      encodeURIComponent(input.fileId),
      encodeURIComponent(input.kind.trim()),
      encodeURIComponent(input.name.trim()),
      String(input.startLine ?? 0),
    ].join(":");
  }

  private normalizePath(value: string): string {
    return value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+/g, "/")
      .replace(/\/+$/, "");
  }
}

