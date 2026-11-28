import * as path from "node:path";

import type { BoundedWalkIgnoreContext } from "../../../shared/bounded-walker";
import { PathNormalizer } from "../../../shared/path-normalizer";
import type {
  WorkspaceIgnoreDecision,
  WorkspaceIgnorePolicyOptions,
} from "../../types";
import { WS_CONSTANTS } from "../../constants";
import {
  NestedIgnoreFileLoader,
  parseGitIgnoreLine,
  gitIgnoreRuleMatches,
  type GitIgnoreRule,
} from "./git-ignore";

export class WorkspaceIgnorePolicy {
  private readonly ignoredDirectoryNames: ReadonlySet<string>;

  private readonly securityDirectoryNames: ReadonlySet<string>;

  private readonly ignoredPaths: ReadonlySet<string>;

  private readonly ignoredFileNames: ReadonlySet<string>;

  private readonly securityFileNames: ReadonlySet<string>;

  private readonly ignoredExtensions: ReadonlySet<string>;

  private readonly securityGlobs: readonly GitIgnoreRule[];

  private readonly nestedIgnoreFiles?: NestedIgnoreFileLoader;

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
      const normalized = this.normalizeName(directoryName);
      if (!WS_CONSTANTS.DEFAULT_SECURITY_DIRECTORY_NAMES.has(normalized)) {
        ignoredDirectoryNames.delete(normalized);
      }
    }

    this.ignoredDirectoryNames = ignoredDirectoryNames;
    this.securityDirectoryNames = WS_CONSTANTS.DEFAULT_SECURITY_DIRECTORY_NAMES;

    this.ignoredPaths = new Set(
      (options.ignoredPaths ?? [])
        .map((ignoredPath) =>
          this.pathNormalizer.normalizeRelative(ignoredPath),
        )
        .filter(Boolean),
    );

    const ignoredFileNames = new Set(WS_CONSTANTS.DEFAULT_IGNORED_FILE_NAMES);

    for (const fileName of options.ignoredFileNames ?? []) {
      const normalized = this.normalizeName(fileName);

      if (normalized) {
        ignoredFileNames.add(normalized);
      }
    }

    this.ignoredFileNames = ignoredFileNames;
    this.securityFileNames = WS_CONSTANTS.DEFAULT_SECURITY_FILE_NAMES;

    const ignoredExtensions = new Set(WS_CONSTANTS.DEFAULT_IGNORED_EXTENSIONS);

    for (const extension of options.ignoredExtensions ?? []) {
      const normalized = this.normalizeExtension(extension);
      if (normalized) {
        ignoredExtensions.add(normalized);
      }
    }

    this.ignoredExtensions = ignoredExtensions;

    this.securityGlobs = WS_CONSTANTS.DEFAULT_SECURITY_FILE_GLOBS.map(
      (pattern) => parseGitIgnoreLine(pattern),
    ).filter((rule): rule is GitIgnoreRule => Boolean(rule));

    this.customRule = options.customRule;

    if (options.fileSystem) {
      this.nestedIgnoreFiles = new NestedIgnoreFileLoader(
        options.fileSystem,
        options.ignoreFileNames ?? WS_CONSTANTS.DEFAULT_IGNORE_FILE_NAMES,
        this.pathNormalizer,
      );
    }
  }

  public evaluateSync(
    context: BoundedWalkIgnoreContext,
  ): WorkspaceIgnoreDecision {
    const relativePath = this.normalizeRelativePath(context.relativePath);
    const name = this.normalizeName(
      this.pathNormalizer.basename(relativePath || context.path),
    );

    const security = this.evaluateSecurity(relativePath, name, context.kind);
    if (security) {
      return security;
    }

    const ignoredDirectory = this.findIgnoredDirectorySegment(
      relativePath,
      context.kind,
      this.ignoredDirectoryNames,
    );
    if (ignoredDirectory) {
      return {
        ignored: true,
        reason: "default_directory",
        matchedRule: ignoredDirectory,
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

  public async evaluate(
    context: BoundedWalkIgnoreContext,
  ): Promise<WorkspaceIgnoreDecision> {
    const syncDecision = this.evaluateSync(context);
    if (syncDecision.ignored || !this.nestedIgnoreFiles) {
      return syncDecision;
    }

    const nested = await this.nestedIgnoreFiles.match(context);
    if (nested) {
      return {
        ignored: true,
        reason: nested.reason,
        matchedRule: nested.matchedRule,
      };
    }

    return syncDecision;
  }

  public shouldIgnore(context: BoundedWalkIgnoreContext): boolean {
    return this.evaluateSync(context).ignored;
  }

  public async shouldIgnoreAsync(
    context: BoundedWalkIgnoreContext,
  ): Promise<boolean> {
    return (await this.evaluate(context)).ignored;
  }

  private evaluateSecurity(
    relativePath: string,
    name: string,
    kind: BoundedWalkIgnoreContext["kind"],
  ): WorkspaceIgnoreDecision | undefined {
    const securityDirectory = this.findIgnoredDirectorySegment(
      relativePath,
      kind,
      this.securityDirectoryNames,
    );
    if (securityDirectory) {
      return {
        ignored: true,
        reason: "security",
        matchedRule: securityDirectory,
      };
    }

    if (this.securityFileNames.has(name)) {
      return {
        ignored: true,
        reason: "security",
        matchedRule: name,
      };
    }

    for (const rule of this.securityGlobs) {
      if (gitIgnoreRuleMatches(rule, relativePath, kind)) {
        return {
          ignored: true,
          reason: "security",
          matchedRule: rule.source,
        };
      }
    }

    return undefined;
  }

  private findIgnoredDirectorySegment(
    relativePath: string,
    kind: BoundedWalkIgnoreContext["kind"],
    names: ReadonlySet<string>,
  ): string | undefined {
    const segments = relativePath.split("/").filter(Boolean);
    const directorySegments =
      kind === "directory" ? segments : segments.slice(0, -1);

    for (const segment of directorySegments) {
      if (names.has(segment)) {
        return segment;
      }
    }

    return undefined;
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

  private normalizeRelativePath(value: string): string {
    try {
      return this.pathNormalizer.normalizeRelative(value);
    } catch {
      return value.replace(/\\/g, "/").replace(/^\/+/, "");
    }
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
