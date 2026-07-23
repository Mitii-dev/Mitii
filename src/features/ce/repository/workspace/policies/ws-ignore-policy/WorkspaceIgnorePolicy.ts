import * as path from "node:path";

import type { BoundedWalkIgnoreContext } from "../../../shared/bounded-walker";
import { PathNormalizer } from "../../../shared/path-normalizer";
import type {
  WorkspaceIgnoreDecision,
  WorkspaceIgnorePolicyOptions,
} from "../../types";
import { WS_CONSTANTS } from "../../constants";

export class WorkspaceIgnorePolicy {
  private readonly ignoredDirectoryNames: ReadonlySet<string>;

  private readonly ignoredPaths: ReadonlySet<string>;

  private readonly ignoredFileNames: ReadonlySet<string>;

  private readonly ignoredExtensions: ReadonlySet<string>;

  private readonly customRule?: WorkspaceIgnorePolicyOptions["customRule"];

  constructor(
    options: WorkspaceIgnorePolicyOptions = {},
    private readonly pathNormalizer: PathNormalizer = new PathNormalizer(),
  ) {
    const ignoredDirectoryNames = new Set(
      WS_CONSTANTS.DEFAULT_IGNORED_DIRECTORY_NAMES,
    );

    for (const directoryName of options.additionalDirectoryNames ?? []) {
      const normalized = this.normalizeName(directoryName);

      if (normalized) {
        ignoredDirectoryNames.add(normalized);
      }
    }

    for (const directoryName of options.allowedDirectoryNames ?? []) {
      ignoredDirectoryNames.delete(this.normalizeName(directoryName));
    }

    this.ignoredDirectoryNames = ignoredDirectoryNames;

    this.ignoredPaths = new Set(
      (options.ignoredPaths ?? [])
        .map((ignoredPath) =>
          this.pathNormalizer.normalizeRelative(ignoredPath),
        )
        .filter(Boolean),
    );

    this.ignoredFileNames = new Set(
      (options.ignoredFileNames ?? [])
        .map((fileName) => this.normalizeName(fileName))
        .filter(Boolean),
    );

    this.ignoredExtensions = new Set(
      (options.ignoredExtensions ?? [])
        .map((extension) => this.normalizeExtension(extension))
        .filter(Boolean),
    );

    this.customRule = options.customRule;
  }

  public evaluate(context: BoundedWalkIgnoreContext): WorkspaceIgnoreDecision {
    const relativePath = this.pathNormalizer.normalizeRelative(
      context.relativePath,
    );

    const name = this.normalizeName(
      this.pathNormalizer.basename(relativePath || context.path),
    );

    if (context.kind === "directory" && this.ignoredDirectoryNames.has(name)) {
      return {
        ignored: true,
        reason: "default_directory",
        matchedRule: name,
      };
    }

    const ignoredPath = this.findMatchingIgnoredPath(relativePath);

    if (ignoredPath) {
      return {
        ignored: true,
        reason: "configured_path",
        matchedRule: ignoredPath,
      };
    }

    if (context.kind === "file" && this.ignoredFileNames.has(name)) {
      return {
        ignored: true,
        reason: "configured_file",
        matchedRule: name,
      };
    }

    if (context.kind === "file") {
      const extension = this.normalizeExtension(
        path.posix.extname(relativePath),
      );

      if (extension && this.ignoredExtensions.has(extension)) {
        return {
          ignored: true,
          reason: "configured_extension",
          matchedRule: extension,
        };
      }
    }

    if (this.customRule?.(context) === true) {
      return {
        ignored: true,
        reason: "custom_rule",
      };
    }

    return {
      ignored: false,
      reason: "not_ignored",
    };
  }

  public shouldIgnore(context: BoundedWalkIgnoreContext): boolean {
    return this.evaluate(context).ignored;
  }

  private findMatchingIgnoredPath(relativePath: string): string | undefined {
    for (const ignoredPath of this.ignoredPaths) {
      if (
        relativePath === ignoredPath ||
        relativePath.startsWith(`${ignoredPath}/`)
      ) {
        return ignoredPath;
      }
    }

    return undefined;
  }

  private normalizeName(value: string): string {
    /*
     * Do not lowercase names.
     * Linux filesystems are case-sensitive.
     */
    return (
      value.trim().replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? ""
    );
  }

  private normalizeExtension(extension: string): string {
    const trimmed = extension.trim();

    if (!trimmed) {
      return "";
    }

    return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
  }
}
