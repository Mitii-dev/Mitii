import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import type { MitiiTask, MitiiTaskStatus } from './types';

export class TaskBoardService {
  private readonly boardPath: string;

  constructor(workspace: string) {
    this.boardPath = join(workspace, '.mitii', 'tasks', 'board.json');
  }

  list(): MitiiTask[] {
    return this.readBoard().tasks;
  }

  add(input: { title: string; prompt: string; dependsOn?: string[] }): MitiiTask {
    const now = Date.now();
    const task: MitiiTask = {
      id: randomUUID().slice(0, 8),
      title: input.title,
      prompt: input.prompt,
      status: 'backlog',
      dependsOn: input.dependsOn ?? [],
      createdAt: now,
      updatedAt: now,
    };
    const board = this.readBoard();
    this.writeBoard({ tasks: [...board.tasks, task] });
    return task;
  }

  update(id: string, patch: Partial<MitiiTask>): MitiiTask {
    const board = this.readBoard();
    const current = board.tasks.find((task) => task.id === id);
    if (!current) throw new Error(`Task not found: ${id}`);
    const next = { ...current, ...patch, updatedAt: Date.now() };
    const tasks = board.tasks.map((task) => task.id === id ? next : task);
    assertNoCycles(tasks);
    this.writeBoard({ tasks });
    return next;
  }

  transition(id: string, status: MitiiTaskStatus): MitiiTask {
    if (status === 'running') {
      const task = this.list().find((item) => item.id === id);
      const blockedBy = (task?.dependsOn ?? []).filter((dep) => this.list().find((item) => item.id === dep)?.status !== 'done');
      if (blockedBy.length) throw new Error(`Task ${id} is blocked by: ${blockedBy.join(', ')}`);
    }
    return this.update(id, { status });
  }

  remove(id: string): boolean {
    const board = this.readBoard();
    const tasks = board.tasks.filter((task) => task.id !== id);
    if (tasks.length === board.tasks.length) return false;
    this.writeBoard({ tasks });
    return true;
  }

  runnable(): MitiiTask[] {
    const tasks = this.list();
    return tasks.filter((task) =>
      task.status === 'backlog' &&
      (task.dependsOn ?? []).every((dep) => tasks.find((candidate) => candidate.id === dep)?.status === 'done')
    );
  }

  private readBoard(): { tasks: MitiiTask[] } {
    if (!existsSync(this.boardPath)) return { tasks: [] };
    const parsed = JSON.parse(readFileSync(this.boardPath, 'utf-8')) as { tasks?: MitiiTask[] };
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  }

  private writeBoard(board: { tasks: MitiiTask[] }): void {
    assertNoCycles(board.tasks);
    mkdirSync(dirname(this.boardPath), { recursive: true });
    writeFileSync(this.boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf-8');
  }
}

function assertNoCycles(tasks: MitiiTask[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Circular task dependency at ${id}`);
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dep)) visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}
