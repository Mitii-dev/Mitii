import { randomUUID } from 'crypto';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import type { ThunderDb } from '../../../features/ce/indexing/ThunderDb';
import { resolveCheckpointDir } from '../../../features/ce/indexing/paths';
import type { GitService } from '../../../features/ce/context/GitService';
import { createLogger } from '../../../kernel/telemetry/Logger';

const log = createLogger('CheckpointService');

export type CheckpointStrategy = 'file-copy' | 'git-stash' | 'shadow-git';
export type CheckpointKind = 'pre-write' | 'manual';

export interface Checkpoint {
  id: string;
  sessionId: string;
  workspace: string;
  kind: CheckpointKind;
  files: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  strategy: CheckpointStrategy;
}

export class CheckpointService {
  constructor(
    private readonly db: ThunderDb,
    private readonly workspace: string,
    private readonly gitService?: GitService,
    private strategy: CheckpointStrategy = 'git-stash'
  ) {}

  setStrategy(strategy: CheckpointStrategy): void {
    this.strategy = strategy;
  }

  async create(sessionId: string, files: string[], kind: CheckpointKind = 'pre-write'): Promise<Checkpoint> {
    const id = randomUUID();
    const metadata: Record<string, unknown> = {};
    let strategy = this.strategy;

    if (this.gitService && files.length > 0 && (strategy === 'git-stash' || strategy === 'shadow-git')) {
      const gitMeta = await this.createGitCheckpoint(id, files, strategy);
      if (gitMeta) {
        Object.assign(metadata, gitMeta);
      } else {
        strategy = 'file-copy';
      }
    }

    if (strategy === 'file-copy' || !metadata.stashRef) {
      await this.copyFilesToCheckpoint(id, files);
      strategy = 'file-copy';
    }

    if (this.gitService) {
      metadata.branch = await this.gitService.getCurrentBranch();
      metadata.diff = (await this.gitService.getDiff(2000)).slice(0, 2000);
    }

    const checkpoint: Checkpoint = {
      id,
      sessionId,
      workspace: this.workspace,
      kind,
      files,
      metadata,
      createdAt: Date.now(),
      strategy,
    };

    this.db.raw.prepare(`
      INSERT INTO checkpoints (id, session_id, workspace, kind, files_json, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, sessionId, this.workspace, kind,
      JSON.stringify(files), JSON.stringify({ ...metadata, strategy }), checkpoint.createdAt
    );

    log.info('Checkpoint created', { id, files: files.length, strategy });
    return checkpoint;
  }

  async restore(checkpointId: string): Promise<boolean> {
    const row = this.db.raw
      .prepare('SELECT files_json, metadata_json FROM checkpoints WHERE id = ?')
      .get(checkpointId) as { files_json: string; metadata_json?: string } | undefined;

    if (!row) return false;

    const files = JSON.parse(row.files_json) as string[];
    const metadata = row.metadata_json ? JSON.parse(row.metadata_json) as Record<string, unknown> : {};
    const strategy = (metadata.strategy as CheckpointStrategy | undefined) ?? 'file-copy';

    if (strategy !== 'file-copy' && typeof metadata.stashRef === 'string' && this.gitService) {
      const restored = await this.gitService.restoreFromStash(metadata.stashRef, files);
      if (restored) {
        log.info('Checkpoint restored from git stash', { id: checkpointId });
        return true;
      }
    }

    const checkpointDir = resolveCheckpointDir(this.workspace, checkpointId);
    for (const relPath of files) {
      const src = join(checkpointDir, relPath);
      const dest = join(this.workspace, relPath);
      if (!existsSync(src)) continue;
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(src));
    }

    log.info('Checkpoint restored from file copy', { id: checkpointId });
    return true;
  }

  list(sessionId?: string): Checkpoint[] {
    const rows = sessionId
      ? this.db.raw.prepare('SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC').all(sessionId)
      : this.db.raw.prepare('SELECT * FROM checkpoints WHERE workspace = ? ORDER BY created_at DESC LIMIT 50').all(this.workspace);

    return (rows as Array<Record<string, unknown>>).map((r) => {
      const metadata = r.metadata_json ? JSON.parse(r.metadata_json as string) as Record<string, unknown> : undefined;
      return {
        id: r.id as string,
        sessionId: r.session_id as string,
        workspace: r.workspace as string,
        kind: r.kind as CheckpointKind,
        files: JSON.parse(r.files_json as string),
        metadata,
        createdAt: r.created_at as number,
        strategy: (metadata?.strategy as CheckpointStrategy | undefined) ?? 'file-copy',
      };
    });
  }

  cleanup(maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db.raw
      .prepare('DELETE FROM checkpoints WHERE created_at < ?')
      .run(cutoff);
    return result.changes;
  }

  private async copyFilesToCheckpoint(id: string, files: string[]): Promise<void> {
    const checkpointDir = resolveCheckpointDir(this.workspace, id);
    mkdirSync(checkpointDir, { recursive: true });

    for (const relPath of files) {
      const src = join(this.workspace, relPath);
      if (!existsSync(src)) continue;
      const dest = join(checkpointDir, relPath);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
  }

  private async createGitCheckpoint(
    id: string,
    files: string[],
    strategy: CheckpointStrategy
  ): Promise<Record<string, unknown> | null> {
    if (!this.gitService) return null;

    const stashMessage = strategy === 'shadow-git' ? `mitii-shadow:${id}` : `mitii:${id}`;
    const stashRef = await this.gitService.stashFiles(stashMessage, files);
    if (!stashRef) return null;

    return { stashRef, stashMessage, strategy };
  }
}
