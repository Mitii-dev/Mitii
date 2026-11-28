import * as path from "node:path";

export type InMemoryFileSystemSeedEntry =
  | {
      kind: "file";
      path: string;
      content: string;
      createdAt?: string;
      modifiedAt?: string;
    }
  | {
      kind: "directory";
      path: string;
      createdAt?: string;
      modifiedAt?: string;
    }
  | {
      kind: "symbolic_link";
      path: string;
      target: string;
      createdAt?: string;
      modifiedAt?: string;
    };

export interface InMemoryFileRecord {
  content: string;
  createdAt: string;
  modifiedAt: string;
}

export interface InMemoryDirectoryRecord {
  createdAt: string;
  modifiedAt: string;
}

export interface InMemorySymbolicLinkRecord {
  target: string;
  createdAt: string;
  modifiedAt: string;
}

export function normalize(targetPath: string): string {
  const slashNormalized = targetPath.replace(/\\/g, "/");

  const absolute = slashNormalized.startsWith("/")
    ? slashNormalized
    : `/${slashNormalized}`;

  return path.posix.normalize(absolute);
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function validateMaximumBytes(maximumBytes: number): void {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError("maximumBytes must be a non-negative safe integer.");
  }
}

export function createNotFoundError(targetPath: string): Error {
  return createFileSystemError(
    "ENOENT",
    `No such file or directory: "${targetPath}".`,
  );
}

export function createNotDirectoryError(targetPath: string): Error {
  return createFileSystemError(
    "ENOTDIR",
    `Path is not a directory: "${targetPath}".`,
  );
}

export function createIsDirectoryError(targetPath: string): Error {
  return createFileSystemError(
    "EISDIR",
    `Path is a directory: "${targetPath}".`,
  );
}

export function createFileExistsError(targetPath: string): Error {
  return createFileSystemError(
    "EEXIST",
    `Path already exists: "${targetPath}".`,
  );
}

export function createInvalidArgumentError(
  targetPath: string,
  message: string,
): Error {
  return createFileSystemError(
    "EINVAL",
    `${message} Path: "${targetPath}".`,
  );
}

export function createFileSystemError(code: string, message: string): Error {
  const error = new Error(message) as Error & {
    code: string;
  };

  error.code = code;

  return error;
}
