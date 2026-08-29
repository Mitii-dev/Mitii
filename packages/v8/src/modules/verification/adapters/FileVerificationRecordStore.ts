import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
    this.directory = trimmed;
  }

  public async save(record: VerificationRecord): Promise<void> {
    const parsed = verificationRecordSchema.parse(record);
    await mkdir(this.directory, { recursive: true });
    await writeAtomic(this.pathFor(parsed.recordId), parsed);
    if (parsed.workspaceId) {
      await writeAtomic(this.latestPathFor(parsed.workspaceId), {
        recordId: parsed.recordId,
        updatedAt: parsed.updatedAt,
        workspaceId: parsed.workspaceId,
      });
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
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
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
      const record = await readRecordFile(join(this.directory, name));
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

async function writeAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  const tempPath = `${path}${TEMP_FILE_SUFFIX}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
