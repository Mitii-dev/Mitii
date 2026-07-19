import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface TeamManifest {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  workspace?: string;
  roles: string[];
}

export interface TeamTask {
  id: string;
  title: string;
  prompt: string;
  status: 'queued' | 'running' | 'review' | 'done' | 'failed';
  teamId: string;
  assigneeRole?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TeamMailboxMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  ts: number;
  read: boolean;
}

export class TeamService {
  private readonly baseDir: string;

  constructor(baseDir = join(homedir(), '.mitii', 'teams')) {
    this.baseDir = baseDir;
  }

  create(name: string, options: { workspace?: string; roles?: string[] } = {}): TeamManifest {
    const dir = this.teamDir(name);
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const manifest: TeamManifest = {
      id: slug(name),
      name,
      workspace: options.workspace,
      roles: options.roles ?? ['planner', 'implementer', 'reviewer', 'docs'],
      createdAt: now,
      updatedAt: now,
    };
    this.writeJson(name, 'manifest.json', manifest);
    this.writeJson(name, 'task-board.json', { tasks: [] });
    this.writeJson(name, 'mailbox.json', { messages: [] });
    this.appendMission(name, `Team created: ${name}`);
    return manifest;
  }

  get(name: string): TeamManifest | undefined {
    return this.readJson<TeamManifest>(name, 'manifest.json');
  }

  status(name: string): { manifest: TeamManifest; tasks: TeamTask[]; messages: TeamMailboxMessage[] } | undefined {
    const manifest = this.get(name);
    if (!manifest) return undefined;
    return {
      manifest,
      tasks: this.tasks(name),
      messages: this.messages(name),
    };
  }

  addTask(name: string, input: { title: string; prompt: string; assigneeRole?: string }): TeamTask {
    const manifest = this.requireTeam(name);
    const tasks = this.tasks(name);
    const now = Date.now();
    const task: TeamTask = {
      id: randomUUID(),
      title: input.title,
      prompt: input.prompt,
      status: 'queued',
      teamId: manifest.id,
      assigneeRole: input.assigneeRole,
      createdAt: now,
      updatedAt: now,
    };
    tasks.push(task);
    this.writeJson(name, 'task-board.json', { tasks });
    this.appendMission(name, `Task added: ${task.title}${task.assigneeRole ? ` -> ${task.assigneeRole}` : ''}`);
    return task;
  }

  sendMessage(name: string, input: { from: string; to: string; text: string }): TeamMailboxMessage {
    this.requireTeam(name);
    const messages = this.messages(name);
    const message: TeamMailboxMessage = {
      id: randomUUID(),
      from: input.from,
      to: input.to,
      text: input.text,
      ts: Date.now(),
      read: false,
    };
    messages.push(message);
    this.writeJson(name, 'mailbox.json', { messages });
    this.appendMission(name, `Message ${message.from} -> ${message.to}`);
    return message;
  }

  private tasks(name: string): TeamTask[] {
    return this.readJson<{ tasks?: TeamTask[] }>(name, 'task-board.json')?.tasks ?? [];
  }

  private messages(name: string): TeamMailboxMessage[] {
    return this.readJson<{ messages?: TeamMailboxMessage[] }>(name, 'mailbox.json')?.messages ?? [];
  }

  private requireTeam(name: string): TeamManifest {
    const manifest = this.get(name);
    if (!manifest) throw new Error(`Team not found: ${name}`);
    return manifest;
  }

  private appendMission(name: string, event: string): void {
    const path = join(this.teamDir(name), 'mission-log.jsonl');
    writeFileSync(path, `${JSON.stringify({ ts: Date.now(), event })}\n`, { flag: 'a' });
  }

  private readJson<T>(name: string, file: string): T | undefined {
    const path = join(this.teamDir(name), file);
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  }

  private writeJson(name: string, file: string, value: unknown): void {
    mkdirSync(this.teamDir(name), { recursive: true });
    writeFileSync(join(this.teamDir(name), file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  private teamDir(name: string): string {
    return join(this.baseDir, slug(name));
  }
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'default';
}
