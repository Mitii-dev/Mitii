import type { TaskAnalysis } from '../../runtime/TaskAnalyzer';
import type { SkillCatalogService } from '../../skills/SkillCatalogService';
import { stripSkillFrontmatter } from '../../skills/SkillCatalogService';
import type { SkillInjectionStyle } from '../../agentic/tierPolicy';
import type { ActIntent } from './actTypes';

const MAX_SKILL_CHARS = 24_000;

export function resolveActSkillNames(intent: ActIntent, taskAnalysis?: TaskAnalysis): string[] {
  const names: string[] = ['using-agent-skills'];

  if (intent === 'audit' || taskAnalysis?.kind === 'audit') {
    names.push('audit-cleanup');
  }

  if (/\b(console\.log|inline style|missing types?|type annotations?|eslint|lint|tech debt|code smells?)\b/i.test(taskAnalysis?.summary ?? '')) {
    names.push('code-smells-and-tech-debt');
  }

  if (/\b(\.env|environment variable|missing keys?|secrets?|api keys?|tokens?)\b/i.test(taskAnalysis?.summary ?? '')) {
    names.push('environment-and-secrets');
  }

  if (
    intent === 'bugfix' ||
    intent === 'diagnose' ||
    /\b(error|failing|failed|debug|repair|fix)\b/i.test(taskAnalysis?.summary ?? '')
  ) {
    names.push('debugging-and-error-recovery');
  }

  if (
    intent === 'feature' ||
    intent === 'refactor' ||
    intent === 'docs' ||
    taskAnalysis?.kind === 'implementation' ||
    taskAnalysis?.kind === 'explicit_plan'
  ) {
    names.push('test-driven-development');
  }

  return [...new Set(names)];
}

export function loadActSkillPlaybooks(
  catalog: SkillCatalogService | undefined,
  skillNames: string[],
  opts: { style?: SkillInjectionStyle; maxChars?: number } = {}
): { context: string; loaded: string[] } {
  const style = opts.style ?? 'full';
  if (!catalog || skillNames.length === 0 || style === 'none' || style === 'catalog') {
    return { context: '', loaded: [] };
  }
  const maxChars = opts.maxChars ?? MAX_SKILL_CHARS;

  const loaded: string[] = [];
  const blocks: string[] = [];
  let totalChars = 0;

  for (const name of skillNames) {
    const skill = catalog.get(name);
    if (!skill) continue;

    const block = [
      `### Skill: ${skill.entry.name}`,
      `Path: ${skill.entry.relPath}`,
      style === 'quick-ref' ? extractQuickRef(skill.content, skill.entry.description) : skill.content.trim(),
    ].join('\n\n');

    if (totalChars + block.length > maxChars) break;
    blocks.push(block);
    loaded.push(skill.entry.name);
    totalChars += block.length;
  }

  if (blocks.length === 0) return { context: '', loaded: [] };

  return {
    context: [
      '## Act skill playbooks (follow these workflows)',
      'These playbooks were pre-loaded for this execution session. Use them to guide implementation, debugging, verification, and recovery.',
      '',
      blocks.join('\n\n---\n\n'),
    ].join('\n'),
    loaded,
  };
}

function extractQuickRef(content: string, description?: string): string {
  const trimmed = stripSkillFrontmatter(content).trim();
  const parts: string[] = [];
  if (description?.trim()) parts.push(`Description: ${description.trim()}`);

  const match = trimmed.match(/^##\s+(Quick Reference|Overview)\s*$/im);
  if (match && match.index !== undefined) {
    const section = trimmed.slice(match.index);
    const next = section.slice(match[0].length).search(/^##\s+/m);
    parts.push((next >= 0 ? section.slice(0, match[0].length + next) : section).trim());
  } else {
    parts.push(trimmed.slice(0, 800).trim());
  }

  return parts.filter(Boolean).join('\n\n');
}

export const ACT_SKILL_TOOL_GUIDANCE = `
ACT SKILLS:
- Call use_skill to load a workspace playbook when the task needs a workflow that is not already injected.
- For bug fixes and failed verification, use debugging-and-error-recovery.
- For implementation and refactors, use test-driven-development when tests or verification strategy are unclear.
- For cleanup tasks, use audit-cleanup and prefer repository audit scripts over manual grep.
- For console logs, inline styles, missing types, lint hygiene, or tech debt, use code-smells-and-tech-debt.
- For .env files, environment variables, keys, tokens, or secrets, use environment-and-secrets and never print secret values.`;
