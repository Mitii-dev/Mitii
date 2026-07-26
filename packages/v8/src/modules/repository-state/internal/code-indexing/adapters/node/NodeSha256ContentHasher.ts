import {
  createHash,
} from "node:crypto";

import type {
  CodeIndexContentHasher,
} from "../../types";

export class NodeSha256ContentHasher
  implements CodeIndexContentHasher
{
  public hash(content: string): string {
    return createHash("sha256")
      .update(content, "utf8")
      .digest("hex");
  }
}
