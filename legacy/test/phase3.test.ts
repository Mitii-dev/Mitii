import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitHubPullRequestService, parseGitHubRemoteUrl } from '../src/features/ce/github';
import { JobQueueService } from '../src/features/ee/distributed-jobs';
import { TeamService } from '../src/features/ee/teams';
import { ThunderDb } from '../src/features/ce/indexing/ThunderDb';
import { MigrationRunner } from '../src/features/ce/indexing/migrations';
import { IndexMaintenanceService } from '../src/features/ce/indexing/IndexMaintenanceService';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Phase 3 platform services', () => {
  it('creates GitHub pull requests with draft defaults', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const service = new GitHubPullRequestService(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return {
        ok: true,
        status: 201,
        json: async () => ({ number: 12, html_url: 'https://github.com/acme/app/pull/12', state: 'open', draft: true }),
      } as Response;
    });

    const result = await service.createPullRequest({
      owner: 'acme',
      repo: 'app',
      head: 'mitii/fix-12',
      base: 'main',
      title: 'Fix issue',
      body: 'Summary',
    }, 'ghp_token');

    expect(result.htmlUrl).toBe('https://github.com/acme/app/pull/12');
    expect(calls[0].url).toBe('https://api.github.com/repos/acme/app/pulls');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ draft: true, head: 'mitii/fix-12' });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer ghp_token');
  });

  it('parses common GitHub remote URLs', () => {
    expect(parseGitHubRemoteUrl('git@github.com:acme/app.git')).toEqual({ owner: 'acme', repo: 'app' });
    expect(parseGitHubRemoteUrl('https://github.com/acme/app.git')).toEqual({ owner: 'acme', repo: 'app' });
  });

  it('persists queued jobs and leases only one worker at a time', () => {
    const cwd = tempDir();
    const queue = new JobQueueService(cwd);
    const job = queue.enqueue({ prompt: 'fix bug', mode: 'agent' });
    expect(new JobQueueService(cwd).list()[0].id).toBe(job.id);

    const leased = queue.lease('worker-a');
    expect(leased?.id).toBe(job.id);
    expect(leased?.leasedBy).toBe('worker-a');
    expect(leased?.resultPath).toBeUndefined();
    expect(queue.lease('worker-b')).toBeUndefined();
    queue.complete(job.id, 'done');
    expect(queue.list()[0]).toMatchObject({ status: 'completed' });
    expect(queue.list()[0]).not.toHaveProperty('leasedBy');

    const failed = queue.enqueue({ prompt: 'try again', mode: 'plan' });
    queue.fail(failed.id, 'temporary provider error');
    expect(queue.retry(failed.id)).toMatchObject({ status: 'queued' });
    expect(queue.list().find((item) => item.id === failed.id)).not.toHaveProperty('error');
    expect(queue.cancel(failed.id)).toMatchObject({ status: 'failed', error: 'Canceled by user.' });
  });

  it('persists teams, tasks, and mailbox messages', () => {
    const base = tempDir();
    const teams = new TeamService(base);
    teams.create('Sprint Team', { workspace: '/repo' });
    const task = teams.addTask('Sprint Team', { title: 'Build PR flow', prompt: 'Implement PR flow', assigneeRole: 'implementer' });
    const message = teams.sendMessage('Sprint Team', { from: 'lead', to: 'implementer', text: 'Please start' });
    const status = new TeamService(base).status('Sprint Team');
    expect(status?.tasks[0].id).toBe(task.id);
    expect(status?.messages[0].id).toBe(message.id);
  });

  it('repairs index state after file deletion and rebuilds FTS', () => {
    const cwd = tempDir();
    const db = new ThunderDb(join(cwd, 'mitii.sqlite'));
    db.open();
    new MigrationRunner(db).run();
    const file = join(cwd, 'src', 'gone.ts');
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(file, 'export const gone = true;');
    const result = db.raw.prepare(`
      INSERT INTO files (workspace, path, rel_path, hash, size, mtime, language, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cwd, file, 'src/gone.ts', 'hash', 25, Date.now(), 'typescript', Date.now());
    db.raw.prepare(`
      INSERT INTO chunks (file_id, chunk_index, start_line, end_line, content, token_estimate, hash)
      VALUES (?, 0, 1, 1, 'export const gone = true;', 5, 'chunk')
    `).run(result.lastInsertRowid);
    db.raw.prepare('INSERT INTO fts_chunks (rel_path, content) VALUES (?, ?)').run('src/gone.ts', 'export const gone = true;');
    rmSync(file);

    const repair = new IndexMaintenanceService(db, cwd, join(cwd, 'mitii.sqlite')).repair();
    expect(repair.removedFiles).toBe(1);
    expect(new IndexMaintenanceService(db, cwd).status().filesTotal).toBe(0);
    db.close();
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mitii-phase3-'));
  dirs.push(dir);
  return dir;
}
