import * as path from "node:path";

export class InvalidPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPathError";
  }
}

export class PathNormalizer {
  /**
   * Normalizes a repository-relative path.
   *
   * Output:
   * - uses forward slashes
   * - has no leading slash
   * - has no trailing slash
   * - resolves "." segments
   * - rejects paths escaping the workspace
   * - rejects absolute paths
   * - rejects paths containing null bytes
   */
  public normalizeRelative(targetPath: string): string {
    this.assertNoNullBytes(targetPath);

    const slashNormalized = targetPath.replace(/\\/g, "/");

    // Prevent silent absolute-to-relative conversion
    if (this.isAbsolute(slashNormalized)) {
      throw new InvalidPathError(
        `Expected a relative path, but received an absolute path: "${targetPath}".`,
      );
    }

    const normalized = path.posix.normalize(slashNormalized);

    const withoutLeadingSlash = normalized.replace(/^\/+/, "");
    const withoutTrailingSlash = withoutLeadingSlash.replace(/\/+$/, "");

    if (
      withoutTrailingSlash === ".." ||
      withoutTrailingSlash.startsWith("../")
    ) {
      throw new InvalidPathError(
        `Path escapes the workspace: "${targetPath}".`,
      );
    }

    if (withoutTrailingSlash === "." || withoutTrailingSlash === "") {
      return "";
    }

    return withoutTrailingSlash;
  }

  /**
   * Converts a physical absolute path into a stable
   * workspace-relative repository path.
   */
  public relativeToRoot(workspaceRoot: string, targetPath: string): string {
    this.assertNoNullBytes(workspaceRoot);
    this.assertNoNullBytes(targetPath);

    const relative = path.relative(workspaceRoot, targetPath);

    return this.normalizeRelative(relative);
  }

  /**
   * Joins repository-relative path segments.
   * Rejects any segment that attempts to inject an absolute path.
   */
  public joinRelative(...segments: readonly string[]): string {
    for (const segment of segments) {
      this.assertNoNullBytes(segment);

      const slashNormalized = segment.replace(/\\/g, "/");

      if (this.isAbsolute(slashNormalized)) {
        throw new InvalidPathError(
          `Absolute path segments are not allowed in joinRelative: "${segment}".`,
        );
      }
    }

    const joined = path.posix.join(
      ...segments.map((segment) => segment.replace(/\\/g, "/")),
    );

    return this.normalizeRelative(joined);
  }

  /**
   * Returns true when targetPath is inside workspaceRoot.
   *
   * Note: Both paths are resolved to absolute paths using the current
   * working directory (if not already absolute) before comparison.
   *
   * This operates on physical paths and is useful before
   * mutations or symbolic-link traversal.
   */
  public isWithinRoot(workspaceRoot: string, targetPath: string): boolean {
    if (targetPath.includes("\0") || workspaceRoot.includes("\0")) {
      return false; // Fail securely rather than throwing for boolean checks
    }

    const absoluteRoot = path.resolve(workspaceRoot);
    const absoluteTarget = path.resolve(targetPath);

    const relative = path.relative(absoluteRoot, absoluteTarget);

    // native path.relative guarantees native path.sep output, making this safe
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  }

  /**
   * Normalizes a physical path without converting it to a
   * repository-relative identifier.
   */
  public normalizePhysical(targetPath: string): string {
    this.assertNoNullBytes(targetPath);
    return path.normalize(targetPath);
  }

  /**
   * Safely extracts the POSIX basename.
   */
  public basename(targetPath: string): string {
    this.assertNoNullBytes(targetPath);

    const normalized = targetPath.replace(/\\/g, "/");
    return path.posix.basename(normalized);
  }

  /**
   * Throws if the path contains poison null bytes.
   */
  private assertNoNullBytes(targetPath: string): void {
    if (targetPath.includes("\0")) {
      throw new InvalidPathError(`Path contains null bytes: "${targetPath}".`);
    }
  }

  /**
   * Checks if a slash-normalized path is absolute, catching both
   * POSIX root (/) and Windows drive letters (C:/).
   */
  private isAbsolute(slashNormalizedPath: string): boolean {
    return (
      path.posix.isAbsolute(slashNormalizedPath) ||
      /^[a-zA-Z]:\//.test(slashNormalizedPath)
    );
  }
}
