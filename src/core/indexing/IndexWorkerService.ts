import { existsSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { IndexService } from './IndexService';
import { IndexQueue, type IndexJob } from './IndexQueue';
import { IndexMaintenanceService, type IndexRepairReport, type IndexStatusReport } from './IndexMaintenanceService';
import { WorkspaceScanner } from './WorkspaceScanner';
import { IgnoreService } from './IgnoreService';
import { detectLanguage, isBinaryByExtension } from './fileUtils';
import { defaultThunderConfig } from '../config/defaults';
import type { IndexingConfig } from '../config/schema';
import { resolveDbPath } from './paths';
import { sortIndexCandidates } from './indexingPolicy';

type WorkerDiscoveredFile = {
  absPath: string;
  relPath: string;
  size: number;
  mtime: number;
  language: string | null;
};

export interface IndexWorkerOptions {
  workspace: string;
  indexing?: Partial<IndexingConfig>;
}

export interface IndexEnqueueResult {
  added: number;
  changed: number;
  deleted: number;
  queued: number;
}

export class IndexWorkerService {
  private indexService: IndexService;
  private queue?: IndexQueue;
  private maintenance?: IndexMaintenanceService;
  private readonly workspace: string;
  private readonly config: IndexingConfig;

  constructor(options: IndexWorkerOptions) {
    this.workspace = resolve(options.workspace);
    this.config = { ...defaultThunderConfig().indexing, ...options.indexing };
    this.indexService = new IndexService(this.workspace);
  }

  async initialize(): Promise<void> {
    await this.indexService.initialize();
    const db = this.indexService.getDb();
    if (!db) throw new Error('Index database failed to initialize');
    this.queue = new IndexQueue(db, {
      maxConcurrency: this.config.maxConcurrency,
      maxFileSizeBytes: this.config.maxFileSizeBytes,
      deferVectorWrites: true,
    });
    this.queue.setVectorService(this.workspace, undefined);
    this.maintenance = new IndexMaintenanceService(db, this.workspace, resolveDbPath(this.workspace));
  }

  status(): IndexStatusReport {
    const { queue, maintenance } = this.ready();
    return maintenance.status(queue.getStatus());
  }

  async enqueue(paths?: string[], options?: { priorityPaths?: string[] }): Promise<IndexEnqueueResult> {
    const { queue, maintenance } = this.ready();
    const discovered = discoverFiles(this.workspace, this.config, paths);
    const scanner = new WorkspaceScanner(this.indexService.getDb()!, this.workspace);
    const diff = scanner.computeDiff(discovered);
    scanner.persistScan(diff);
    for (const relPath of diff.deleted) {
      maintenance.removeFile(relPath);
    }
    const changed = sortIndexCandidates(
      [...diff.added, ...diff.changed],
      [...(options?.priorityPaths ?? []), ...this.config.priorityPaths]
    );
    const jobs: IndexJob[] = changed
      .map((file) => {
        const fileId = scanner.getFileId(file.relPath);
        return fileId ? { fileId, relPath: file.relPath, absPath: file.absPath, language: file.language } : undefined;
      })
      .filter((job): job is IndexJob => Boolean(job));
    queue.enqueue(jobs);
    return {
      added: diff.added.length,
      changed: diff.changed.length,
      deleted: diff.deleted.length,
      queued: jobs.length,
    };
  }

  delete(relPath: string): boolean {
    const { maintenance } = this.ready();
    return maintenance.removeFile(relPath);
  }

  repair(): IndexRepairReport {
    const { maintenance } = this.ready();
    return maintenance.repair();
  }

  dispose(): void {
    this.queue?.cancel();
    this.indexService.dispose();
  }

  private ready(): { queue: IndexQueue; maintenance: IndexMaintenanceService } {
    if (!this.queue || !this.maintenance) {
      throw new Error('Index worker is not initialized');
    }
    return { queue: this.queue, maintenance: this.maintenance };
  }
}

function discoverFiles(workspace: string, config: IndexingConfig, paths?: string[]): WorkerDiscoveredFile[] {
  const ignore = new IgnoreService();
  ignore.load(workspace, {
    respectGitignore: config.respectGitignore,
    respectThunderignore: config.respectThunderignore,
  });
  const roots = paths && paths.length > 0 ? paths : ['.'];
  const files: WorkerDiscoveredFile[] = [];
  for (const input of roots) {
    const absPath = resolve(workspace, input);
    if (!absPath.startsWith(workspace) || !existsSync(absPath)) continue;
    walk(absPath, workspace, ignore, config, files);
  }
  return files;
}

function walk(
  absPath: string,
  workspace: string,
  ignore: IgnoreService,
  config: IndexingConfig,
  files: WorkerDiscoveredFile[]
): void {
  const relPath = relative(workspace, absPath).replace(/\\/g, '/') || '.';
  if (ignore.isIgnored(relPath)) return;
  let stat;
  try {
    stat = statSync(absPath);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    for (const entry of readdirSync(absPath)) walk(join(absPath, entry), workspace, ignore, config, files);
    return;
  }
  if (!stat.isFile() || stat.size > config.hardSkipSizeBytes || isBinaryByExtension(relPath)) return;
  files.push({
    absPath,
    relPath,
    size: stat.size,
    mtime: stat.mtimeMs,
    language: detectLanguage(relPath),
  });
}
