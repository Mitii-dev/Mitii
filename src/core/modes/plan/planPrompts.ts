import type { ProjectCatalog } from '../ask/askTypes';
import { formatProjectCatalog } from '../ask/ProjectCatalog';
import type { PlanRoute } from './planTypes';
import type { AskScopeResolution } from '../ask/askTypes';
import { createLogger } from '../../telemetry/Logger';

const log = createLogger('PlanPrompts');

export function buildPlanPromptContext(
  userMessage: string,
  route: PlanRoute,
  scope: AskScopeResolution,
  catalog?: ProjectCatalog,
  skills?: { suggestedSkills: string[]; appliedSkills: string[] }
): string {
  const lines = [
    '## Plan routing',
    `Intent: ${route.intent}`,
    `Complexity: ${route.complexity}`,
    `Force structured plan: ${route.forcePlan ? 'yes' : 'no'}`,
    `Quality profile: ${route.qualityProfile}`,
    `Read-only grounding required: ${route.groundingRequired ? 'yes' : 'no'}`,
    `Scope status: ${scope.status}`,
    `Scope reason: ${scope.reason}`,
  ];

  if (skills?.appliedSkills.length) {
    lines.push(`Planning skills loaded: ${skills.appliedSkills.join(', ')}`);
  } else if (skills?.suggestedSkills.length) {
    lines.push(`Planning skills to load via use_skill: ${skills.suggestedSkills.join(', ')}`);
  }

  if (scope.projects.length > 0) {
    lines.push(`Scoped projects: ${scope.projects.map((project) => `${project.id} (${project.root})`).join(', ')}`);
  }

  if (catalog) {
    lines.push('', formatProjectCatalog(catalog));
  }

  lines.push(
    '',
    '## Plan response contract',
    'Use Ask-style read-only discovery first, then compile a structured, persisted execution plan.',
    'Plan steps must be concrete enough for the SDK/headless agent boundary: stable goal, assumptions, affected files, tools, success criteria, risk, and verification.',
    'Follow loaded planning skill playbooks for dependency ordering, acceptance criteria, and verification per step.',
    'Do not execute writes in Plan mode. Execution happens later through the same saved plan contract an SDK can expose as Agent.plan() followed by Agent.executePlan().'
  );

  if (scope.status === 'ambiguous') {
    lines.push('', 'The project scope is ambiguous. Ask one scoped clarification before finalizing a plan that would affect only one project.');
  }

  lines.push('', `Original Plan request: ${userMessage}`);
  const context = lines.join('\n');
  log.debug('Built plan prompt context', { chars: context.length, scopeStatus: scope.status });
  return context;
}
