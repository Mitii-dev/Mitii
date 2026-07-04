import { HeadlessAgentHost } from '../headless/HeadlessAgentHost';
import { WorktreeService } from '../git';
import { TaskBoardService } from './TaskBoardService';
import type { MitiiTask } from './types';

export interface ParallelAgentRunnerOptions {
  workspace: string;
  parallel?: number;
  runtime?: 'real' | 'stub';
  providerType?: ConstructorParameters<typeof HeadlessAgentHost>[0]['providerType'];
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface ParallelAgentRunResult {
  started: string[];
  completed: string[];
  failed: Array<{ id: string; error: string }>;
}

export class ParallelAgentRunner {
  private readonly board: TaskBoardService;
  private readonly worktrees: WorktreeService;

  constructor(private readonly options: ParallelAgentRunnerOptions) {
    this.board = new TaskBoardService(options.workspace);
    this.worktrees = new WorktreeService(options.workspace);
  }

  async runRunnable(): Promise<ParallelAgentRunResult> {
    const queue = [...this.board.runnable()];
    const parallel = Math.max(1, Math.min(this.options.parallel ?? 2, 8));
    const result: ParallelAgentRunResult = { started: [], completed: [], failed: [] };
    const workers = Array.from({ length: Math.min(parallel, queue.length) }, async () => {
      while (queue.length) {
        const task = queue.shift();
        if (!task) return;
        result.started.push(task.id);
        try {
          await this.runTask(task);
          result.completed.push(task.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.board.update(task.id, { status: 'failed', error: message });
          result.failed.push({ id: task.id, error: message });
        }
      }
    });
    await Promise.all(workers);
    return result;
  }

  async runTask(task: MitiiTask): Promise<void> {
    this.board.transition(task.id, 'running');
    const worktree = await this.worktrees.create({ taskId: task.id });
    this.board.update(task.id, { worktreeId: worktree.taskId, branch: worktree.branch });
    const host = new HeadlessAgentHost({
      cwd: worktree.path,
      runtime: this.options.runtime,
      providerType: this.options.providerType,
      baseUrl: this.options.baseUrl,
      model: this.options.model,
      apiKey: this.options.apiKey,
      approval: 'auto',
      indexWorkspace: false,
    });
    const chunks: string[] = [];
    try {
      for await (const event of host.agent(task.prompt)) {
        if (event.type === 'assistant_delta') chunks.push(event.content);
        if (event.type === 'error') throw new Error(event.message);
      }
      const summary = chunks.join('').trim() || 'Task completed.';
      this.board.update(task.id, {
        status: 'review',
        result: { summary, filesChanged: [] },
      });
    } finally {
      host.dispose();
    }
  }
}
