import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync, rmSync } from 'fs';
import { basename, join } from 'path';
import { homedir } from 'os';
import type { ContextItem, ContextQuery, ContextSource } from '../../../features/ce/context/types';
import type { Observation, ObservationType } from './MemoryService';
import { filterSecrets } from './MemoryService';
import { createLogger } from '../../../kernel/telemetry/Logger';

const log = createLogger('AutoMemoryFileWriter');

export type AutoMemoryScope = 'user' | 'workspace' | 'both';

export interface AutoMemoryOptions {
  enabled?: boolean;
  scope?: AutoMemoryScope;
  maxRecentFiles?: number;
}

export class AutoMemoryFileWriter {
  constructor(private readonly workspace: string, private readonly options: AutoMemoryOptions = {}) {}

  writeObservation(observation: Observation): string[] {
    if (this.options.enabled === false) return [];
    const cleanText = filterSecrets(observation.text);
    if (!cleanText) return [];

    const paths: string[] = [];
    for (const dir of this.resolveDirs()) {
      try {
        mkdirSync(dir, { recursive: true });
        const fileName = `${formatDate(observation.createdAt)}-${slugify(observation.type)}-${slugify(cleanText).slice(0, 48)}.md`;
        const filePath = join(dir, fileName);
        const body = [
          `# ${titleForType(observation.type)}`,
          '',
          `- Type: ${observation.type}`,
          `- Session: ${observation.sessionId}`,
          `- Created: ${new Date(observation.createdAt).toISOString()}`,
          observation.files?.length ? `- Files: ${observation.files.join(', ')}` : '',
          '',
          cleanText,
          '',
        ].filter(Boolean).join('\n');
        writeFileSync(filePath, body, { encoding: 'utf-8', mode: 0o600 });
        this.appendIndex(dir, fileName, observation.type, cleanText);
        paths.push(filePath);
      } catch (error) {
        log.warn('Auto-memory markdown write failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return paths;
  }

  readRecent(maxFiles = this.options.maxRecentFiles ?? 8): Array<{ relPath: string; content: string; mtimeMs: number }> {
    if (this.options.enabled === false) return [];
    const out: Array<{ relPath: string; content: string; mtimeMs: number }> = [];
    for (const dir of this.resolveDirs()) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((entry) => entry.endsWith('.md') && entry !== 'MEMORY.md')) {
        const abs = join(dir, file);
        try {
          const st = statSync(abs);
          if (!st.isFile() || st.size > 64_000) continue;
          out.push({ relPath: displayPath(dir, file), content: readFileSync(abs, 'utf-8').slice(0, 4000), mtimeMs: st.mtimeMs });
        } catch {
          // Skip unreadable memory files.
        }
      }
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxFiles);
  }

  prune(days = 30): number {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const dir of this.resolveDirs()) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((entry) => entry.endsWith('.md') && entry !== 'MEMORY.md')) {
        const abs = join(dir, file);
        try {
          const st = statSync(abs);
          if (st.isFile() && st.mtimeMs < cutoff) {
            rmSync(abs, { force: true });
            removed += 1;
          }
        } catch {
          // Skip unreadable entries.
        }
      }
    }
    return removed;
  }

  private appendIndex(dir: string, fileName: string, type: ObservationType, text: string): void {
    const indexPath = join(dir, 'MEMORY.md');
    if (!existsSync(indexPath)) {
      writeFileSync(indexPath, '# Mitii Auto-Memory\n\n', { encoding: 'utf-8', mode: 0o600 });
    }
    appendFileSync(indexPath, `- ${new Date().toISOString()} [${type}](./${fileName}) - ${text.replace(/\s+/g, ' ').slice(0, 140)}\n`, 'utf-8');
  }

  private resolveDirs(): string[] {
    const scope = this.options.scope ?? 'user';
    const dirs: string[] = [];
    if (scope === 'user' || scope === 'both') {
      dirs.push(join(homedir(), '.mitii', 'projects', projectHash(this.workspace), 'memory'));
    }
    if (scope === 'workspace' || scope === 'both') {
      dirs.push(join(this.workspace, '.mitii', 'auto-memory'));
    }
    return dirs;
  }
}

export class AutoMemoryContextSource implements ContextSource {
  readonly id = 'auto-memory';

  constructor(private readonly writer: AutoMemoryFileWriter) {}

  async retrieve(_query: ContextQuery): Promise<ContextItem[]> {
    return this.writer.readRecent().map((memory, index) => ({
      id: `auto-memory-${index}-${basename(memory.relPath)}`,
      source: 'auto-memory',
      relPath: memory.relPath,
      content: memory.content,
      score: 7,
      reason: 'Recent auto-memory markdown',
      tokenEstimate: Math.ceil(memory.content.length / 4),
    }));
  }
}

function projectHash(workspace: string): string {
  return createHash('sha1').update(workspace).digest('hex').slice(0, 16);
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'memory';
}

function titleForType(type: ObservationType): string {
  return type.split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function displayPath(dir: string, file: string): string {
  if (dir.includes('/.mitii/auto-memory')) return `.mitii/auto-memory/${file}`;
  return `~/.mitii/projects/.../memory/${file}`;
}
