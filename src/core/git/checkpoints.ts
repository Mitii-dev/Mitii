import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { canonicalGitActionSignature } from './intents';

export interface GitCheckpoint {
  id: string;
  head: string;
  branch: string;
  stagedTreeHash: string;
  dirtyFiles: string[];
  timestamp: string;
  operation: string;
  restorationInstructions: string[];
}

export async function createGitCheckpoint(workspace: string, operation: string): Promise<GitCheckpoint> {
  const [head, branch, stagedTreeHash, dirty] = await Promise.all([
    git(workspace, ['rev-parse', 'HEAD']).catch(() => ''),
    git(workspace, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
    git(workspace, ['write-tree']).catch(() => ''),
    git(workspace, ['status', '--porcelain=v1']).catch(() => ''),
  ]);
  const timestamp = new Date().toISOString();
  const dirtyFiles = dirty.split(/\r?\n/).map((line) => line.slice(3).trim()).filter(Boolean);
  const id = canonicalGitActionSignature('checkpoint', { head, branch, stagedTreeHash, dirtyFiles, operation, timestamp });
  const checkpoint: GitCheckpoint = {
    id,
    head: head.trim(),
    branch: branch.trim(),
    stagedTreeHash: stagedTreeHash.trim(),
    dirtyFiles,
    timestamp,
    operation,
    restorationInstructions: [
      `Inspect current state: git status --short`,
      `Return to recorded branch if needed: git switch ${branch.trim() || '<branch>'}`,
      `Restore HEAD if explicitly intended: git reset --mixed ${head.trim() || '<head>'}`,
      'Review dirty files before restoring or discarding local edits.',
    ],
  };
  persistCheckpoint(workspace, checkpoint);
  return checkpoint;
}

function persistCheckpoint(workspace: string, checkpoint: GitCheckpoint): void {
  const dir = join(workspace, '.mitii', 'git-checkpoints');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${checkpoint.id}.json`), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `git ${args.join(' ')} failed`));
    });
  });
}
