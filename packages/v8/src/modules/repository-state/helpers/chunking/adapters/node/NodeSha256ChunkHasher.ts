import {
  createHash,
} from "node:crypto";

import {
  CHUNKING_IDS,
} from "../../constants";

import type {
  ChunkContentHasher,
} from "../../types";

export class NodeSha256ChunkHasher
  implements ChunkContentHasher
{
  public readonly id =
    CHUNKING_IDS
      .NODE_SHA256_HASHER;

  public hash(
    content: string,
  ): string {
    return createHash("sha256")
      .update(content, "utf8")
      .digest("hex");
  }
}

