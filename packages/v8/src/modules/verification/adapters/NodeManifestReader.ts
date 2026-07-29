import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type { VerificationManifestReaderPort } from "../contracts";

/**
 * Workspace-backed manifest reader for trusted project metadata.
 * Verification receives only relative manifest paths from discovery adapters.
 */
export class NodeManifestReader implements VerificationManifestReaderPort {
  private readonly root: string;

  constructor(workspaceRoot: string) {
    this.root = resolve(workspaceRoot);
  }

  public async exists(relativePath: string): Promise<boolean> {
    return (await this.readText(relativePath)) !== null;
  }

  public async readText(relativePath: string): Promise<string | null> {
    const path = this.resolveInsideWorkspace(relativePath);
    if (!path) {
      return null;
    }
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  }

  private resolveInsideWorkspace(relativePath: string): string | null {
    const candidate = resolve(this.root, relativePath);
    if (candidate === this.root || candidate.startsWith(`${this.root}${sep}`)) {
      return candidate;
    }
    return null;
  }
}
