import { isAbsolute, relative, resolve } from "node:path";

import type { WorkspaceFileSystemPort } from "../../../engine/tool-runtime";

import type { VerificationManifestReaderPort } from "../contracts";

/**
 * Host-backed manifest reader: trusted project metadata via Tool Runtime FS.
 * Paths are workspace-relative (same convention as discovery helpers).
 */
export class WorkspaceFileSystemManifestReader
  implements VerificationManifestReaderPort
{
  private readonly workspaceRoot: string;
  private workspaceRealRoot?: Promise<string>;

  constructor(
    private readonly params: {
      fileSystem: WorkspaceFileSystemPort;
      workspaceRoot: string;
      maxBytes?: number;
    },
  ) {
    this.workspaceRoot = params.fileSystem.resolve(params.workspaceRoot, ".");
  }

  public async exists(relativePath: string): Promise<boolean> {
    const absolute = this.resolveInsideWorkspace(relativePath);
    if (!absolute) {
      return false;
    }
    try {
      const stat = await this.params.fileSystem.lstat(absolute);
      return (
        (stat.kind === "file" || stat.kind === "symlink") &&
        (await this.realPathIsInsideWorkspace(absolute))
      );
    } catch {
      return false;
    }
  }

  public async readText(relativePath: string): Promise<string | null> {
    const absolute = this.resolveInsideWorkspace(relativePath);
    if (!absolute) {
      return null;
    }
    try {
      const stat = await this.params.fileSystem.lstat(absolute);
      if (stat.kind !== "file" && stat.kind !== "symlink") {
        return null;
      }
      const realPath = await this.params.fileSystem.realpath(absolute);
      if (!(await this.pathIsInsideWorkspace(realPath))) {
        return null;
      }
      const result = await this.params.fileSystem.readFile(realPath, {
        maxBytes: this.params.maxBytes ?? 512_000,
      });
      return result.content;
    } catch {
      return null;
    }
  }

  private resolveInsideWorkspace(relativePath: string): string | null {
    const absolute = this.params.fileSystem.resolve(
      this.params.workspaceRoot,
      normalize(relativePath),
    );
    return pathIsInside(absolute, this.workspaceRoot) ? absolute : null;
  }

  private async realPathIsInsideWorkspace(absolutePath: string): Promise<boolean> {
    const realPath = await this.params.fileSystem.realpath(absolutePath);
    return this.pathIsInsideWorkspace(realPath);
  }

  private async pathIsInsideWorkspace(absolutePath: string): Promise<boolean> {
    return pathIsInside(absolutePath, await this.getWorkspaceRealRoot());
  }

  private getWorkspaceRealRoot(): Promise<string> {
    this.workspaceRealRoot ??= this.params.fileSystem.realpath(
      this.workspaceRoot,
    );
    return this.workspaceRealRoot;
  }
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function pathIsInside(path: string, root: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  const relativePath = relative(normalizedRoot, normalizedPath);
  return (
    relativePath === "" ||
    (relativePath.length > 0 &&
      !relativePath.startsWith("..") &&
      !isAbsolute(relativePath))
  );
}
