import * as path from "node:path";

import type { FileSystemReadPort } from "../../../../shared/filesystem";
import type { BoundedWalkIgnoreContext } from "../../../../shared/bounded-walker";
import { PathNormalizer } from "../../../../shared/path-normalizer";
import {
  applyGitIgnoreRules,
  parseGitIgnoreContents,
  type GitIgnoreRule,
} from "./parseGitIgnore";

export type NestedIgnoreFileKind = "gitignore" | "mitiiignore";

export interface NestedIgnoreMatch {
  ignored: boolean;
  reason: NestedIgnoreFileKind;
  matchedRule: string;
}

const IGNORE_FILE_READ_LIMIT_BYTES = 256 * 1024;

export class NestedIgnoreFileLoader {
  private readonly cache = new Map<string, Promise<readonly GitIgnoreRule[]>>();

  constructor(
    private readonly fileSystem: FileSystemReadPort,
    private readonly fileNames: readonly string[],
    private readonly pathNormalizer: PathNormalizer = new PathNormalizer(),
  ) {}

  public async match(
    context: BoundedWalkIgnoreContext,
  ): Promise<NestedIgnoreMatch | undefined> {
    const relativePath = this.pathNormalizer.normalizeRelative(
      context.relativePath,
    );
    const directoryKind = context.kind === "directory";
    const parentRelative = directoryKind
      ? relativePath
      : this.parentRelative(relativePath);

    const ignoreDirs = this.ancestorDirectories(parentRelative);
    let matched: NestedIgnoreMatch | undefined;

    for (const ignoreDir of ignoreDirs) {
      for (const fileName of this.fileNames) {
        const rules = await this.loadRules(context.root, ignoreDir, fileName);
        if (rules.length === 0) {
          continue;
        }

        const relativeToIgnore = this.relativeToIgnoreDir(
          relativePath,
          ignoreDir,
        );
        const rule = applyGitIgnoreRules(rules, relativeToIgnore, context.kind);
        if (!rule) {
          continue;
        }

        matched = {
          ignored: !rule.negated,
          reason: this.reasonForFileName(fileName),
          matchedRule: `${fileName}:${rule.source}`,
        };
      }
    }

    return matched?.ignored ? matched : undefined;
  }

  private ancestorDirectories(relativeDir: string): string[] {
    const directories = [""];
    if (!relativeDir) {
      return directories;
    }

    const segments = relativeDir.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      directories.push(current);
    }

    return directories;
  }

  private relativeToIgnoreDir(relativePath: string, ignoreDir: string): string {
    if (!ignoreDir) {
      return relativePath;
    }

    if (relativePath === ignoreDir) {
      return this.pathNormalizer.basename(relativePath);
    }

    const prefix = `${ignoreDir}/`;
    if (relativePath.startsWith(prefix)) {
      return relativePath.slice(prefix.length);
    }

    return relativePath;
  }

  private parentRelative(relativePath: string): string {
    const segments = relativePath.split("/").filter(Boolean);
    segments.pop();
    return segments.join("/");
  }

  private loadRules(
    root: string,
    relativeDir: string,
    fileName: string,
  ): Promise<readonly GitIgnoreRule[]> {
    const ignorePath = this.joinIgnorePath(root, relativeDir, fileName);
    const cached = this.cache.get(ignorePath);
    if (cached) {
      return cached;
    }

    const pending = this.readRules(ignorePath);
    this.cache.set(ignorePath, pending);
    return pending;
  }

  private async readRules(ignorePath: string): Promise<readonly GitIgnoreRule[]> {
    try {
      if (!(await this.fileSystem.exists(ignorePath))) {
        return [];
      }

      const contents = await this.fileSystem.readText(ignorePath, {
        encoding: "utf8",
        maximumBytes: IGNORE_FILE_READ_LIMIT_BYTES,
      });
      return parseGitIgnoreContents(contents);
    } catch {
      return [];
    }
  }

  private joinIgnorePath(
    root: string,
    relativeDir: string,
    fileName: string,
  ): string {
    const segments = relativeDir.split("/").filter(Boolean);
    return path.join(root, ...segments, fileName);
  }

  private reasonForFileName(fileName: string): NestedIgnoreFileKind {
    return fileName === ".gitignore" ? "gitignore" : "mitiiignore";
  }
}
