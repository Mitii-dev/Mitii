import * as vscode from 'vscode';
import { existsSync, promises as fs, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { IgnoreService } from './IgnoreService';
import { isBinaryByExtension, detectLanguage } from './fileUtils';
import type { IndexingConfig } from '../../../kernel/config/schema';

export interface DiscoveredFile {
  absPath: string;
  relPath: string;
  size: number;
  mtime: number;
  language: string | null;
}

export interface DiscoveryOptions {
  roots?: string[];
  limit?: number;
  yieldEvery?: number;
}

export class FileDiscoveryService {
  constructor(
    private readonly workspacePath: string,
    private readonly ignoreService: IgnoreService,
    private readonly config: IndexingConfig
  ) {}

  discover(): DiscoveredFile[] {
    const results: DiscoveredFile[] = [];
    const exclude = this.getVsCodeExcludes();

    const walk = (dir: string): void => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }

      for (const entry of entries) {
        const absPath = join(dir, entry);
        const relPath = relative(this.workspacePath, absPath).replace(/\\/g, '/');

        if (this.ignoreService.isIgnored(relPath)) {
          continue;
        }

        if (this.isVsCodeExcluded(relPath, exclude)) {
          continue;
        }

        let stat;
        try {
          stat = statSync(absPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          walk(absPath);
          continue;
        }

        if (!stat.isFile()) {
          continue;
        }

        if (stat.size > this.config.hardSkipSizeBytes) {
          continue;
        }

        if (isBinaryByExtension(relPath)) {
          continue;
        }

        results.push({
          absPath,
          relPath,
          size: stat.size,
          mtime: stat.mtimeMs,
          language: detectLanguage(relPath),
        });
      }
    };

    walk(this.workspacePath);
    return results;
  }

  async discoverAsync(options: DiscoveryOptions = {}): Promise<DiscoveredFile[]> {
    const results: DiscoveredFile[] = [];
    const exclude = this.getVsCodeExcludes();
    const roots = options.roots?.length ? options.roots : ['.'];
    const limit = options.limit && options.limit > 0 ? options.limit : Number.POSITIVE_INFINITY;
    const yieldEvery = options.yieldEvery && options.yieldEvery > 0 ? options.yieldEvery : 100;
    let visited = 0;

    const walk = async (inputPath: string): Promise<void> => {
      if (results.length >= limit) return;

      const absInput = resolve(this.workspacePath, inputPath);
      if (!isInsideWorkspace(absInput, this.workspacePath) || !existsSync(absInput)) return;

      const relInput = relative(this.workspacePath, absInput).replace(/\\/g, '/') || '.';
      if (this.ignoreService.isIgnored(relInput) || this.isVsCodeExcluded(relInput, exclude)) return;

      let stat;
      try {
        stat = await fs.stat(absInput);
      } catch {
        return;
      }

      visited += 1;
      if (visited % yieldEvery === 0) {
        await new Promise((resolveYield) => setTimeout(resolveYield, 0));
      }

      if (stat.isDirectory()) {
        let entries: string[];
        try {
          entries = await fs.readdir(absInput);
        } catch {
          return;
        }
        for (const entry of entries) {
          await walk(join(inputPath, entry));
          if (results.length >= limit) return;
        }
        return;
      }

      if (!stat.isFile()) return;
      if (stat.size > this.config.hardSkipSizeBytes) return;
      if (isBinaryByExtension(relInput)) return;

      results.push({
        absPath: absInput,
        relPath: relInput,
        size: stat.size,
        mtime: stat.mtimeMs,
        language: detectLanguage(relInput),
      });
    };

    for (const root of roots) {
      await walk(root);
      if (results.length >= limit) break;
    }

    return results;
  }

  private getVsCodeExcludes(): Record<string, boolean> {
    const filesExclude = vscode.workspace.getConfiguration('files').get<Record<string, boolean>>('exclude', {});
    const searchExclude = vscode.workspace.getConfiguration('search').get<Record<string, boolean>>('exclude', {});
    return { ...filesExclude, ...searchExclude };
  }

  private isVsCodeExcluded(relPath: string, exclude: Record<string, boolean>): boolean {
    for (const [pattern, enabled] of Object.entries(exclude)) {
      if (!enabled) {
        continue;
      }
      const regex = globToRegex(pattern);
      if (regex.test(relPath)) {
        return true;
      }
    }
    return false;
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function isInsideWorkspace(absPath: string, workspacePath: string): boolean {
  const rel = relative(workspacePath, absPath);
  return rel === '' || (!rel.startsWith('..') && !rel.includes('..\\'));
}
