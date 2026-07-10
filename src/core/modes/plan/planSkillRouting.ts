import type { TaskAnalysis } from '../../runtime/TaskAnalyzer';
import type { SkillCatalogService } from '../../skills/SkillCatalogService';
import type { PlanIntent } from './planTypes';
import { createLogger } from '../../telemetry/Logger';

const log = createLogger('PlanSkillRouting');

const MAX_SKILL_CHARS = 24_000;

/** Skills to load for planning, ordered by priority. */
export function resolvePlanningSkillNames(
  intent: PlanIntent,
  taskAnalysis?: TaskAnalysis
): string[] {
  const names: string[] = ['using-agent-skills', 'planning-and-task-breakdown'];

  if (intent === 'audit' || taskAnalysis?.kind === 'audit') {
    names.push('audit-cleanup');
  }
  if (/\b(console\.log|inline style|missing types?|type annotations?|eslint|lint|tech debt|code smells?)\b/i.test(taskAnalysis?.summary ?? '')) {
    names.push('code-smells-and-tech-debt');
  }
  if (/\b(\.env|environment variable|missing keys?|secrets?|api keys?|tokens?)\b/i.test(taskAnalysis?.summary ?? '')) {
    names.push('environment-and-secrets');
  }
  if (intent === 'bugfix' || taskAnalysis?.kind === 'question') {
    names.push('debugging-and-error-recovery');
  }

  const resolved = [...new Set(names)];
  log.debug('Resolved planning skill names', { intent, taskKind: taskAnalysis?.kind, resolved });
  return resolved;
}

export function loadPlanningSkillPlaybooks(
  catalog: SkillCatalogService | undefined,
  skillNames: string[]
): { context: string; loaded: string[] } {
  if (!catalog || skillNames.length === 0) {
    log.debug('Skipping planning skill playbook load', { hasCatalog: Boolean(catalog), skillNames });
    return { context: '', loaded: [] };
  }

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
      skill.content.trim(),
    ].join('\n\n');

    if (totalChars + block.length > MAX_SKILL_CHARS) {
      skipped.push(name);
      break;
    }
    blocks.push(block);
    loaded.push(skill.entry.name);
    totalChars += block.length;
  }

  if (skipped.length > 0) {
    log.debug('Some planning skills were not loaded', { skipped, budgetChars: MAX_SKILL_CHARS });
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
      '',
      blocks.join('\n\n---\n\n'),
    ].join('\n'),
    loaded,
  };
}

export const PLAN_SKILL_TOOL_GUIDANCE = `
PLANNING SKILLS:
- Call use_skill to load a workspace playbook when you need one not already injected below.
- For task breakdown and phased plans, use_skill("planning-and-task-breakdown") if not pre-loaded.
- For skill discovery/routing, use_skill("using-agent-skills") if not pre-loaded.
- For tech-debt and env/secrets tasks, prefer the bundled script-backed skills before manual inspection.
- Follow loaded skill workflows: dependency graph, vertical slices, acceptance criteria, and verification commands per step.`;
