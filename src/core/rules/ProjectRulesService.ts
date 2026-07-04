import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { ContextItem, ContextQuery, ContextSource } from '../context/types';
import { createLogger } from '../telemetry/Logger';

const log = createLogger('ProjectRulesService');

const RULE_FILE = 'MITII.md';

export interface ProjectRuleFile {
  relPath: string;
  content: string;
}

export class ProjectRulesService {
  constructor(private readonly workspace: string) {}

  load(maxCharsPerFile = 5000): ProjectRuleFile[] {
    if (!this.workspace) return [];
    const files: ProjectRuleFile[] = [];
    this.tryAddFile(files, RULE_FILE, maxCharsPerFile);
    return files;
  }

  count(): number {
    return this.load(1).length;
  }

  private tryAddFile(files: ProjectRuleFile[], relPath: string, maxChars: number): void {
    if (files.some((f) => f.relPath === relPath)) return;
    const abs = join(this.workspace, relPath);
    if (!existsSync(abs)) return;
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > 256_000) return;
      const content = readFileSync(abs, 'utf-8').slice(0, maxChars).trim();
      if (content) files.push({ relPath, content });
    } catch (error) {
      log.warn('Could not read project rules file', {
        relPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export class ProjectRulesContextSource implements ContextSource {
  readonly id = 'project-rules';

  constructor(private readonly rulesService: ProjectRulesService) {}

  async retrieve(_query: ContextQuery): Promise<ContextItem[]> {
    return this.rulesService.load().map((rule, index) => ({
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
