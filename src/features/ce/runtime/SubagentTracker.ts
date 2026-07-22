import { randomUUID } from 'crypto';

export type SubagentStatus = 'queued' | 'running' | 'done' | 'error';

export interface SubagentRun {
  id: string;
  type: string;
  task: string;
  focus?: string;
  scope?: string;
  progress?: number;
  status: SubagentStatus;
  startedAt: number;
  finishedAt?: number;
  summary?: string;
  error?: string;
}

export type SubagentUpdateCallback = (runs: SubagentRun[]) => void;

const TERMINAL_STATUSES = new Set<SubagentStatus>(['done', 'error']);
const MAX_TERMINAL_RUNS = 12;

export class SubagentTracker {
  private runs: SubagentRun[] = [];
  private onUpdate: SubagentUpdateCallback | undefined;

  setUpdateCallback(cb: SubagentUpdateCallback | undefined): void {
    this.onUpdate = cb;
  }

  clear(): void {
    this.runs = [];
    this.notify();
  }

  start(task: string, focus?: string, metadata: { type?: string; scope?: string; progress?: number } = {}): string {
    const run: SubagentRun = {
      id: randomUUID(),
      type: metadata.type ?? 'research',
      task,
      focus,
      scope: metadata.scope,
      progress: metadata.progress,
      status: 'running',
      startedAt: Date.now(),
    };
    this.runs = [...this.runs, run];
    this.pruneTerminalRuns();
    this.notify();
    return run.id;
  }

  finish(id: string, summary: string, metadata: { progress?: number } = {}): void {
    this.runs = this.runs.map((r) =>
      r.id === id
        ? { ...r, status: 'done' as const, finishedAt: Date.now(), progress: metadata.progress ?? r.progress, summary: summary.slice(0, 300) }
        : r
    );
    this.pruneTerminalRuns();
    this.notify();
  }

  fail(id: string, error: string): void {
    this.runs = this.runs.map((r) =>
      r.id === id
        ? { ...r, status: 'error' as const, finishedAt: Date.now(), error: error.slice(0, 200) }
        : r
    );
    this.pruneTerminalRuns();
    this.notify();
  }

  getRuns(): SubagentRun[] {
    return [...this.runs];
  }

  /** Retain all non-terminal runs; prune only finished/error history. */
  private pruneTerminalRuns(): void {
    const active = this.runs.filter((run) => !TERMINAL_STATUSES.has(run.status));
    const terminal = this.runs.filter((run) => TERMINAL_STATUSES.has(run.status));
    this.runs = [...active, ...terminal.slice(-MAX_TERMINAL_RUNS)];
  }

  private notify(): void {
    this.onUpdate?.(this.getRuns());
  }
}
