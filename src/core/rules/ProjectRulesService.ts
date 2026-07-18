import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, relative, resolve } from 'path';
import type { ContextItem, ContextQuery, ContextSource } from '../context/types';
import type { TierPolicy } from '../agentic/tierPolicy';
import { createLogger } from '../telemetry/Logger';

import { BUNDLED_DEFAULT_RULES } from './bundledDefaultRules';

const log = createLogger('ProjectRulesService');

const BUNDLED_RULES_REL_PATH = 'mitii:defaults/path-resolution';

const MAX_RULE_FILE_BYTES = 256_000;
const DEFAULT_TOTAL_CHARS = 20_000;

const RULE_LAYERS = [
  { relPath: 'MITII.md', label: 'workspace' },
  { relPath: 'AGENTS.md', label: 'compatibility' },
  { relPath: 'CLAUDE.md', label: 'compatibility' },
] as const;

const RULE_DIRS = [
  '.mitii/rules',
  '.cursor/rules',
] as const;

export interface ProjectRuleFile {
  relPath: string;
  content: string;
}

/**
 * Rules are always-on workspace policy and conventions injected every turn.
 * Use SkillCatalogService for on-demand task workflows and playbooks instead.
 */
export class ProjectRulesService {
  constructor(private readonly workspace: string) {}

  load(maxCharsPerFile = 5000, maxTotalChars = DEFAULT_TOTAL_CHARS): ProjectRuleFile[] {
    if (!this.workspace) return [];
    const files: ProjectRuleFile[] = [];
    const budget = { remaining: Math.max(0, maxTotalChars) };

    const onDiskPathRule = existsSync(join(this.workspace, '.mitii/rules/path-resolution.md'));
    if (!onDiskPathRule) {
      const bundled = BUNDLED_DEFAULT_RULES.slice(0, Math.min(maxCharsPerFile, budget.remaining)).trim();
      if (bundled) {
        files.push({ relPath: BUNDLED_RULES_REL_PATH, content: bundled });
        budget.remaining -= bundled.length;
      }
    }

    this.tryAddAbsFile(files, join(homedir(), '.mitii', 'MITTII.md'), '~/.mitii/MITTII.md', maxCharsPerFile, budget);
    for (const layer of RULE_LAYERS) {
      this.tryAddFile(files, layer.relPath, maxCharsPerFile, budget);
    }
    for (const dir of RULE_DIRS) {
      for (const relPath of this.listMarkdownFiles(dir)) {
        this.tryAddFile(files, relPath, maxCharsPerFile, budget);
      }
    }
    this.tryAddFile(files, '.mitii/MITTII.local.md', maxCharsPerFile, budget);
    return files;
  }

  count(): number {
    return this.load(1).length;
  }

  private tryAddFile(
    files: ProjectRuleFile[],
    relPath: string,
    maxChars: number,
    budget: { remaining: number }
  ): void {
    this.tryAddAbsFile(files, join(this.workspace, relPath), relPath, maxChars, budget);
  }

  private tryAddAbsFile(
    files: ProjectRuleFile[],
    abs: string,
    relPath: string,
    maxChars: number,
    budget: { remaining: number }
  ): void {
    if (files.some((f) => f.relPath === relPath)) return;
    if (budget.remaining <= 0) return;
    if (!existsSync(abs)) return;
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > MAX_RULE_FILE_BYTES) return;
      const raw = readFileSync(abs, 'utf-8').slice(0, maxChars).trim();
      const expanded = this.expandFileReferences(raw, dirname(abs), relPath, Math.min(maxChars, budget.remaining));
      const content = expanded.slice(0, Math.min(maxChars, budget.remaining)).trim();
      if (content) files.push({ relPath, content });
      budget.remaining -= content.length;
    } catch (error) {
      log.warn('Could not read project rules file', {
        relPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private listMarkdownFiles(relDir: string): string[] {
    const root = join(this.workspace, relDir);
    if (!existsSync(root)) return [];
    const out: string[] = [];
    const visit = (dir: string): void => {
      let entries: string[];
      try {
        entries = readdirSync(dir).sort();
      } catch {
        return;
      }
      for (const entry of entries) {
        const abs = join(dir, entry);
        try {
          const st = statSync(abs);
          if (st.isDirectory()) {
            visit(abs);
          } else if (st.isFile() && /\.md$/i.test(entry)) {
            out.push(relative(this.workspace, abs).replace(/\\/g, '/'));
          }
        } catch {
          // skip unreadable entries
        }
      }
    };
    visit(root);
    return out;
  }

  private expandFileReferences(content: string, baseDir: string, ownerRelPath: string, maxChars: number): string {
    let remaining = maxChars;
    return content.replace(/(^|\s)@([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g, (match, prefix: string, ref: string) => {
      if (remaining <= 0) return match;
      const resolved = this.resolveReference(baseDir, ref);
      if (!resolved) return match;
      try {
        const st = statSync(resolved.absPath);
        if (!st.isFile() || st.size > MAX_RULE_FILE_BYTES) return match;
        const text = readFileSync(resolved.absPath, 'utf-8')
          .slice(0, Math.min(3000, remaining))
          .trim();
        if (!text) return match;
        remaining -= text.length;
        return `${prefix}@${ref}\n\n[Referenced file: ${resolved.relPath}]\n${text}\n[/Referenced file]\n`;
      } catch (error) {
        log.warn('Could not read referenced project rules file', {
          ownerRelPath,
          ref,
          error: error instanceof Error ? error.message : String(error),
        });
        return match;
      }
    });
  }

  private resolveReference(baseDir: string, ref: string): { absPath: string; relPath: string } | null {
    const absPath = resolve(baseDir, ref);
    const relPath = relative(this.workspace, absPath).replace(/\\/g, '/');
    if (!relPath || relPath.startsWith('..') || relPath === '.') return null;
    return { absPath, relPath };
  }
}

export class ProjectRulesContextSource implements ContextSource {
  readonly id = 'project-rules';

  constructor(
    private readonly rulesService: ProjectRulesService,
    private readonly getTierPolicy?: () => TierPolicy | undefined
  ) {}

  async retrieve(query: ContextQuery): Promise<ContextItem[]> {
    const policy = query.tierPolicy ?? this.getTierPolicy?.();
    return this.rulesService.load(policy?.rulesMaxCharsPerFile, policy?.rulesMaxTotalChars).map((rule, index) => ({
      id: `project-rule-${index}-${rule.relPath}`,
      source: 'project-rules',
      relPath: rule.relPath,
      content: rule.content,
      score: 9,
      reason: 'Project methodology/rules file',
      tokenEstimate: Math.ceil(rule.content.length / 4),
    }));
  }
}
