import { execFile } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { promisify } from 'util';
import { scaffoldMitiiWorkspace } from '../mcp/scaffoldMitiiWorkspace';
import { branchForTask, defaultWorktreePath } from './worktreePaths';
import type { WorktreeCreateOptions, WorktreeInfo } from './worktreeTypes';

const execFileAsync = promisify(execFile);

export class WorktreeService {
  private readonly registryPath: string;

  constructor(private readonly repoRoot: string, private readonly extensionRoot = repoRoot) {
    this.repoRoot = resolve(repoRoot);
    this.registryPath = join(this.repoRoot, '.mitii', 'worktrees.json');
  }

  list(): WorktreeInfo[] {
    const entries = this.readRegistry();
    return entries.map((entry) => ({
      ...entry,
      status: existsSync(entry.path) && entry.status !== 'removed' ? 'active' : entry.status === 'removed' ? 'removed' : 'orphaned',
    }));
  }

  getPath(taskId: string): string | undefined {
    return this.list().find((entry) => entry.taskId === taskId && entry.status === 'active')?.path;
  }

  async create(options: WorktreeCreateOptions): Promise<WorktreeInfo> {
    await this.ensureGitRepo();
    const existing = this.list().find((entry) => entry.taskId === options.taskId && entry.status === 'active');
    if (existing) return existing;

    const path = defaultWorktreePath(this.repoRoot, options.taskId);
    const branch = options.branch ?? branchForTask(options.taskId);
    const args = ['worktree', 'add', '-b', branch, path];
    if (options.baseRef) args.push(options.baseRef);
    await execFileAsync('git', args, { cwd: this.repoRoot });
    scaffoldMitiiWorkspace(path, { extensionRoot: this.extensionRoot, forceBundledSkills: false });

    const entry: WorktreeInfo = {
      taskId: options.taskId,
      path,
      branch,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.writeRegistry([...this.readRegistry().filter((item) => item.taskId !== options.taskId), entry]);
    return entry;
  }

  async remove(taskId: string, options: { force?: boolean; deleteBranch?: boolean } = {}): Promise<boolean> {
    const entry = this.list().find((item) => item.taskId === taskId);
    if (!entry) return false;
    if (entry.status === 'active') {
      const dirty = await this.isDirty(entry.path);
      if (dirty && !options.force) {
        throw new Error(`Worktree ${taskId} has uncommitted changes. Re-run with --force to remove.`);
      }
      await execFileAsync('git', ['worktree', 'remove', ...(options.force ? ['--force'] : []), entry.path], { cwd: this.repoRoot });
    } else if (existsSync(entry.path) && options.force) {
      rmSync(entry.path, { recursive: true, force: true });
    }
    if (options.deleteBranch) {
      await execFileAsync('git', ['branch', '-D', entry.branch], { cwd: this.repoRoot }).catch(() => undefined);
    }
    this.writeRegistry(this.readRegistry().map((item) =>
      item.taskId === taskId ? { ...item, status: 'removed', updatedAt: Date.now() } : item
    ));
    return true;
  }

  prune(): WorktreeInfo[] {
    const kept = this.readRegistry().filter((entry) => entry.status === 'active' && existsSync(entry.path));
    this.writeRegistry(kept);
    return kept;
  }

  private async ensureGitRepo(): Promise<void> {
    await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: this.repoRoot });
  }

  private async isDirty(path: string): Promise<boolean> {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: path });
    return stdout.trim().length > 0;
  }

  private readRegistry(): WorktreeInfo[] {
    try {
      const parsed = JSON.parse(readFileSync(this.registryPath, 'utf-8')) as WorktreeInfo[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeRegistry(entries: WorktreeInfo[]): void {
    mkdirSync(dirname(this.registryPath), { recursive: true });
    writeFileSync(this.registryPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');
  }
}
