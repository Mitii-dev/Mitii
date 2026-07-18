import type { TaskAnalysis } from '../../runtime/TaskAnalyzer';
import type { SkillCatalogService } from '../../skills/SkillCatalogService';
import { stripSkillFrontmatter } from '../../skills/SkillCatalogService';
import { MAX_SKILL_INJECTION_CHARS, QUICK_REF_FALLBACK_CHARS } from '../../skills/skillLimits';
import { formatSkillRuntimeContext, type SkillRuntimeContext } from '../../skills/skillRuntimeContext';
import type { SkillInjectionStyle } from '../../agentic/tierPolicy';
import type { PlanIntent } from './planTypes';
import { createLogger } from '../../telemetry/Logger';
import { resolveRoute, resolveSkillsForRoute } from '../../pipeline';

const log = createLogger('PlanSkillRouting');

const MAX_SKILL_CHARS = MAX_SKILL_INJECTION_CHARS;

/** Skills to pre-inject for planning (0–1 active). Meta skill is not auto-injected. */
export function resolvePlanningSkillNames(
  intent: PlanIntent,
  taskAnalysis?: TaskAnalysis,
  options: { sourceMode?: 'plan' | 'agent' } = {}
): string[] {
  const summary = taskAnalysis?.summary ?? intent;
  const analysis: TaskAnalysis = taskAnalysis
    ? { ...taskAnalysis, planIntent: taskAnalysis.planIntent ?? intent }
    : {
        kind: intent === 'docs' ? 'docs' : intent === 'audit' ? 'audit' : 'explicit_plan',
        complexity: 'medium',
        shouldPlan: true,
        shouldVerify: false,
        shouldUseSubagents: false,
        summary,
        planIntent: intent,
      };
  const route = resolveRoute(summary, analysis);
  if (intent === 'docs') route.intent = 'docs';
  if (intent === 'audit') route.intent = 'audit';
  const skills = resolveSkillsForRoute(route, analysis, {
    sourceMode: options.sourceMode ?? 'plan',
    planning: true,
  });
  log.debug('Resolved planning skill names', {
    intent,
    taskKind: taskAnalysis?.kind,
    active: skills.activeSkill,
    inject: skills.injectSkills,
  });
  return skills.injectSkills;
}

export function loadPlanningSkillPlaybooks(
  catalog: SkillCatalogService | undefined,
  skillNames: string[],
  opts: { style?: SkillInjectionStyle; maxChars?: number; runtimeContext?: SkillRuntimeContext } = {}
): { context: string; loaded: string[] } {
  const style = opts.style ?? 'full';
  if (!catalog || skillNames.length === 0 || style === 'none' || style === 'catalog') {
    log.debug('Skipping planning skill playbook load', { hasCatalog: Boolean(catalog), skillNames });
    return { context: '', loaded: [] };
  }
  const maxChars = opts.maxChars ?? MAX_SKILL_CHARS;

  const loaded: string[] = [];
  const skipped: string[] = [];
  const blocks: string[] = [];
  let totalChars = 0;

  for (const name of skillNames) {
    const skill = catalog.get(name);
    if (!skill) {
      skipped.push(name);
      continue;
    }

    const block = [
      `### Skill: ${skill.entry.name}`,
      `Path: ${skill.entry.relPath}`,
      style === 'quick-ref' ? extractQuickRef(skill.content, skill.entry.description) : skill.content.trim(),
    ].join('\n\n');

    if (totalChars + block.length > maxChars) {
      skipped.push(name);
      break;
    }
    blocks.push(block);
    loaded.push(skill.entry.name);
    totalChars += block.length;
  }

  if (skipped.length > 0) {
    log.debug('Some planning skills were not loaded', { skipped, budgetChars: maxChars });
  }

  if (blocks.length === 0) {
    log.debug('No planning skill playbooks loaded');
    return { context: '', loaded: [] };
  }

  log.debug('Loaded planning skill playbooks', { loaded, totalChars });

  return {
    context: [
      '## Planning skill playbooks (follow these workflows)',
      'These playbooks were pre-loaded for this planning session. Apply their process, structure, and verification rules when discovering and compiling the plan.',
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

export const PLAN_SKILL_TOOL_GUIDANCE = `
PLANNING SKILLS:
- Follow the single injected planning playbook first (0–1 active). Call use_skill only for deferred skills.
- Do not auto-load using-agent-skills; call use_skill("using-agent-skills") only if you need meta routing help.
- For README/package docs, prefer the documentation skill — never release_plan_controller.
- For dependency/dead-code cleanup only, use audit-cleanup. Other audit subtypes are not knip/depcheck tasks.
- Prefer builtin read tools over MCP filesystem during discovery.
- Follow loaded skill workflows for planning structure, acceptance criteria, and verification.`;
