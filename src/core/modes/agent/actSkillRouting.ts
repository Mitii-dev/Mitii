import type { TaskAnalysis } from '../../runtime/TaskAnalyzer';
import type { SkillCatalogService } from '../../skills/SkillCatalogService';
import { stripSkillFrontmatter } from '../../skills/SkillCatalogService';
import { MAX_SKILL_INJECTION_CHARS, QUICK_REF_FALLBACK_CHARS } from '../../skills/skillLimits';
import { formatSkillRuntimeContext, type SkillRuntimeContext } from '../../skills/skillRuntimeContext';
import type { SkillInjectionStyle } from '../../agentic/tierPolicy';
import type { ActIntent } from './actTypes';
import { resolveRoute, resolveSkillsForRoute, type SkillResolution } from '../../pipeline';

const MAX_SKILL_CHARS = MAX_SKILL_INJECTION_CHARS;

/**
 * Skills to pre-inject (0–1 active). Uses pipeline skill resolver.
 * `using-agent-skills` is never auto-injected.
 */
export function resolveActSkillNames(intent: ActIntent, taskAnalysis?: TaskAnalysis): string[] {
  return resolveActSkillResolution(intent, taskAnalysis).injectSkills;
}

/** Full skill resolution for telemetry / prompt catalog hints. */
export function resolveActSkillResolution(intent: ActIntent, taskAnalysis?: TaskAnalysis): SkillResolution {
  const summary = taskAnalysis?.summary ?? intent;
  const analysis: TaskAnalysis = taskAnalysis
    ? {
        ...taskAnalysis,
        actIntent: taskAnalysis.actIntent ?? intent,
        kind:
          intent === 'docs' && taskAnalysis.kind === 'implementation'
            ? 'docs'
            : taskAnalysis.kind,
      }
    : {
        kind:
          intent === 'docs'
            ? 'docs'
            : intent === 'log_audit'
              ? 'log_audit'
              : intent === 'audit'
                ? 'audit'
                : 'implementation',
        complexity: 'medium',
        shouldPlan: false,
        shouldVerify: true,
        shouldUseSubagents: false,
        summary,
        actIntent: intent,
      };
  const route = resolveRoute(summary, analysis);
  if (intent === 'docs') route.intent = 'docs';
  if (intent === 'log_audit') {
    route.intent = 'log_audit';
    route.executionPath = 'log_audit';
  }
  return resolveSkillsForRoute(route, analysis, { sourceMode: 'agent', planning: false });
}

export function loadActSkillPlaybooks(
  catalog: SkillCatalogService | undefined,
  skillNames: string[],
  opts: { style?: SkillInjectionStyle; maxChars?: number; runtimeContext?: SkillRuntimeContext } = {}
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
      formatSkillRuntimeContext(opts.runtimeContext),
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
    parts.push(trimmed.slice(0, QUICK_REF_FALLBACK_CHARS).trim());
  }

  return parts.filter(Boolean).join('\n\n');
}

export const ACT_SKILL_TOOL_GUIDANCE = `
ACT SKILLS:
- Follow the single injected playbook first (0–1 active skill). Call use_skill only for a deferred/catalog skill that is not already injected.
- Do not load using-agent-skills unless you need meta skill-routing help.
- For documentation / README work, use the documentation skill — never release_plan_controller or audit-cleanup.
- For dependency/dead-code cleanup only, use audit-cleanup. Other "audit" subtypes are not knip/depcheck tasks.
- Prefer builtin read_file / write_file over MCP filesystem tools.`;
