import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { verificationRecordSchema } from "../contracts";
import type {
  VerificationRecord,
  VerificationRecordStorePort,
} from "../contracts";
import { VerificationError } from "../contracts";

const RECORD_FILE_SUFFIX = ".json";
const TEMP_FILE_SUFFIX = ".tmp";
const LATEST_PREFIX = "latest-";

/**
 * Durable verification-record store under a host directory (typically
 * `<workspace>/.mitii/verification/`).
 *
 * Writes are atomic (temp file + rename). A per-workspace latest pointer
 * lets a later run reload the snapshot without scanning chat history.
 * The leaf directory must be a real directory (not a symlink).
 */
export class FileVerificationRecordStore
  implements VerificationRecordStorePort
{
  private readonly directory: string;

  constructor(directory: string) {
    const trimmed = directory.trim();
    if (!trimmed) {
      throw new VerificationError(
        "misconfigured_ports",
        "FileVerificationRecordStore requires a non-empty directory.",
      );
    }
    this.directory = resolve(trimmed);
  }

  public async save(record: VerificationRecord): Promise<void> {
    const parsed = verificationRecordSchema.parse(record);
    const directory = await ensureSafeDirectory(this.directory);
    await writeAtomic(join(directory, `${sanitizeId(parsed.recordId)}${RECORD_FILE_SUFFIX}`), parsed);
    if (parsed.workspaceId) {
      await writeAtomic(
        join(
          directory,
          `${LATEST_PREFIX}${sanitizeId(parsed.workspaceId)}${RECORD_FILE_SUFFIX}`,
        ),
        {
          recordId: parsed.recordId,
          updatedAt: parsed.updatedAt,
          workspaceId: parsed.workspaceId,
        },
      );
    }
  }

  public async load(
    recordId: string,
  ): Promise<VerificationRecord | undefined> {
    return readRecordFile(this.pathFor(recordId));
  }

  public async loadLatest(
    workspaceId: string,
  ): Promise<VerificationRecord | undefined> {
    const pointer = await readJsonFile(this.latestPathFor(workspaceId));
    const pointedId =
      pointer &&
      typeof pointer === "object" &&
      typeof (pointer as { recordId?: unknown }).recordId === "string"
        ? (pointer as { recordId: string }).recordId
        : undefined;
    if (pointedId) {
      const pointed = await this.load(pointedId);
      if (pointed && pointed.workspaceId === workspaceId) {
        return pointed;
      }
    }
    return this.scanLatest(workspaceId);
  }

  private async scanLatest(
    workspaceId: string,
  ): Promise<VerificationRecord | undefined> {
    let names: string[];
    let directory: string;
    try {
      directory = await ensureSafeDirectory(this.directory);
      names = await readdir(directory);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      if (error instanceof VerificationError) {
        throw error;
      }
      throw new VerificationError(
        "store_failed",
        "Failed to list verification records.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
    const matches: VerificationRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(RECORD_FILE_SUFFIX) || name.startsWith(LATEST_PREFIX)) {
        continue;
      }
      const record = await readRecordFile(join(directory, name));
      if (record?.workspaceId === workspaceId) {
        matches.push(record);
      }
    }
    if (matches.length === 0) {
      return undefined;
    }
    return matches.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0];
  }

  private pathFor(recordId: string): string {
    return join(this.directory, `${sanitizeId(recordId)}${RECORD_FILE_SUFFIX}`);
  }

  private latestPathFor(workspaceId: string): string {
    return join(
      this.directory,
      `${LATEST_PREFIX}${sanitizeId(workspaceId)}${RECORD_FILE_SUFFIX}`,
    );
  }
}

/**
 * Ensure the store leaf is a real directory (not a symlink), then return its
 * realpath for writes. Parent path aliases (e.g. macOS `/tmp`) are allowed.
 */
async function ensureSafeDirectory(directory: string): Promise<string> {
  const absolute = resolve(directory);
  try {
    await mkdir(absolute, { recursive: true, mode: 0o700 });
  } catch (error) {
    if (!isExist(error)) {
      throw new VerificationError(
        "store_failed",
        "Failed to create the verification record directory.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  try {
    const leaf = await lstat(absolute);
    if (leaf.isSymbolicLink()) {
      throw new VerificationError(
        "store_failed",
        "Verification record directory must not be a symbolic link.",
        { cause: absolute },
      );
    }
    if (!leaf.isDirectory()) {
      throw new VerificationError(
        "store_failed",
        "Verification record path must be a directory.",
        { cause: absolute },
      );
    }
    return await realpath(absolute);
  } catch (error) {
    if (error instanceof VerificationError) {
      throw error;
    }
    throw new VerificationError(
      "store_failed",
      "Failed to inspect the verification record directory.",
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function writeAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  const tempPath = `${path}${TEMP_FILE_SUFFIX}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tempPath, path);
}

async function readRecordFile(
  path: string,
): Promise<VerificationRecord | undefined> {
  const raw = await readJsonFile(path);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = verificationRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

async function readJsonFile(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw new VerificationError(
      "store_failed",
      "Failed to read a verification record.",
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

function sanitizeId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new VerificationError(
      "invalid_input",
      "Verification record id must be non-empty.",
    );
  }
  const safe = trimmed.replace(/[^A-Za-z0-9._-]+/g, "_");
  if (!safe || safe === "." || safe === "..") {
    throw new VerificationError(
      "invalid_input",
      `Verification record id is not filesystem-safe: ${value}`,
    );
  }
  return safe;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isExist(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}
