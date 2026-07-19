import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

export type MitiiJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface MitiiJob {
  id: string;
  prompt: string;
  cwd: string;
  mode: 'ask' | 'plan' | 'agent' | 'review';
  status: MitiiJobStatus;
  createdAt: number;
  updatedAt: number;
  leaseUntil?: number;
  leasedBy?: string;
  attempts: number;
  resultPath?: string;
  error?: string;
}

export class JobQueueService {
  private readonly queuePath: string;
  private readonly completedDir: string;

  constructor(private readonly workspace: string) {
    this.queuePath = join(workspace, '.mitii', 'jobs', 'queue.json');
    this.completedDir = join(workspace, '.mitii', 'jobs', 'completed');
  }

  enqueue(input: { prompt: string; cwd?: string; mode?: MitiiJob['mode'] }): MitiiJob {
    const jobs = this.readQueue();
    const now = Date.now();
    const job: MitiiJob = {
      id: randomUUID(),
      prompt: input.prompt,
      cwd: input.cwd ?? this.workspace,
      mode: input.mode ?? 'agent',
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      attempts: 0,
    };
    jobs.push(job);
    this.writeQueue(jobs);
    return job;
  }

  list(): MitiiJob[] {
    return this.readQueue();
  }

  lease(workerId: string, leaseMs = 10 * 60 * 1000): MitiiJob | undefined {
    const now = Date.now();
    const jobs = this.readQueue();
    const job = jobs.find((item) =>
      item.status === 'queued' || (item.status === 'running' && (item.leaseUntil ?? 0) < now)
    );
    if (!job) return undefined;
    job.status = 'running';
    job.updatedAt = now;
    job.leaseUntil = now + leaseMs;
    job.leasedBy = workerId;
    job.attempts += 1;
    this.writeQueue(jobs);
    return job;
  }

  complete(id: string, output: string): MitiiJob | undefined {
    const jobs = this.readQueue();
    const job = jobs.find((item) => item.id === id);
    if (!job) return undefined;
    mkdirSync(this.completedDir, { recursive: true });
    const resultPath = join(this.completedDir, `${id}.md`);
    writeFileSync(resultPath, output, 'utf8');
    job.status = 'completed';
    job.updatedAt = Date.now();
    job.leaseUntil = undefined;
    job.leasedBy = undefined;
    job.resultPath = resultPath;
    this.writeQueue(jobs);
    return job;
  }

  fail(id: string, error: string): MitiiJob | undefined {
    const jobs = this.readQueue();
    const job = jobs.find((item) => item.id === id);
    if (!job) return undefined;
    job.status = 'failed';
    job.updatedAt = Date.now();
    job.leaseUntil = undefined;
    job.leasedBy = undefined;
    job.error = error;
    this.writeQueue(jobs);
    return job;
  }

  retry(id: string): MitiiJob | undefined {
    const jobs = this.readQueue();
    const job = jobs.find((item) => item.id === id);
    if (!job) return undefined;
    job.status = 'queued';
    job.updatedAt = Date.now();
    job.leaseUntil = undefined;
    job.leasedBy = undefined;
    job.error = undefined;
    this.writeQueue(jobs);
    return job;
  }

  cancel(id: string): MitiiJob | undefined {
    const jobs = this.readQueue();
    const job = jobs.find((item) => item.id === id);
    if (!job || job.status === 'completed') return undefined;
    job.status = 'failed';
    job.updatedAt = Date.now();
    job.leaseUntil = undefined;
    job.leasedBy = undefined;
    job.error = 'Canceled by user.';
    this.writeQueue(jobs);
    return job;
  }

  private readQueue(): MitiiJob[] {
    try {
      const parsed = JSON.parse(readFileSync(this.queuePath, 'utf8')) as { jobs?: MitiiJob[] };
      return Array.isArray(parsed.jobs) ? parsed.jobs : [];
    } catch {
      return [];
    }
  }

  private writeQueue(jobs: MitiiJob[]): void {
    mkdirSync(dirname(this.queuePath), { recursive: true });
    const tmp = `${this.queuePath}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ jobs }, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.queuePath);
  }
}
