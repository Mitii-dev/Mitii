import type { WorkspaceFileSystemPort } from "../../../engine/tool-runtime";

import type { VerificationManifestReaderPort } from "../contracts";

/**
 * Host-backed manifest reader: trusted project metadata via Tool Runtime FS.
 * Paths are workspace-relative (same convention as discovery helpers).
 */
export class WorkspaceFileSystemManifestReader
  implements VerificationManifestReaderPort
{
  constructor(
    private readonly params: {
      fileSystem: WorkspaceFileSystemPort;
      workspaceRoot: string;
      maxBytes?: number;
    },
  ) {}

  public async exists(relativePath: string): Promise<boolean> {
    const absolute = this.params.fileSystem.resolve(
      this.params.workspaceRoot,
      normalize(relativePath),
    );
    try {
      const stat = await this.params.fileSystem.lstat(absolute);
      return stat.kind === "file" || stat.kind === "symlink";
    } catch {
      return false;
    }
  }

  public async readText(relativePath: string): Promise<string | null> {
    const absolute = this.params.fileSystem.resolve(
      this.params.workspaceRoot,
      normalize(relativePath),
    );
    try {
      const result = await this.params.fileSystem.readFile(absolute, {
        maxBytes: this.params.maxBytes ?? 512_000,
      });
      return result.content;
    } catch {
      return null;
    }
  }
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}
