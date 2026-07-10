import type { AskScopeResolution, ProjectCatalog } from '../ask/askTypes';
import { formatProjectCatalog } from '../ask/ProjectCatalog';
import { formatVerifyPlanForAgent, resolveProjectVerifyCommands } from '../../runtime/verifyCommandDiscovery';
import type { ActRoute } from './actTypes';

export function buildActPromptContext(
  userMessage: string,
  route: ActRoute,
  scope: AskScopeResolution,
  catalog?: ProjectCatalog,
  options: {
    appliedSkills?: string[];
    suggestedSkills?: string[];
    savedPlanId?: string;
    verifyCommands?: string[];
    workspaceRoot?: string;
  } = {}
): string {
  const lines = [
    '## Act routing',
    `Intent: ${route.intent}`,
    `Execution path: ${route.executionPath}`,
    `Complexity: ${route.complexity}`,
    `Verify required: ${route.shouldVerify ? 'yes' : 'no'}`,
    `Summary: ${route.summary}`,
    '',
    '## Act workflow contract',
    '- Read or search relevant files before writing.',
    '- Keep edits scoped to the user request, active plan, and touched files.',
    '- Prefer targeted patches and preserve unrelated user changes.',
    '- Run project-appropriate verification after implementation (discovered from package.json, not hardcoded).',
  ];

  if (route.intent === 'diagnose') {
    lines.push(
      '',
      '## Diagnosis-first request',
      '- Read the referenced file(s)/logs and identify the root cause before changing anything.',
      '- Trace the failure to the code that actually enforces/produces it (e.g. a policy check, validator, or spawn call) — do not assume a file is the cause just because it shares a name or path with the symptom.',
      '- If the user asked you to fix something, fix it. "Document the limitation" or "explain why this is restricted" is not an acceptable substitute for a fix unless the restriction is truly intentional and the user should be told to change their request instead.',
      '- Report findings directly; only apply a minimal fix if the cause is obvious and scoped to what was read.',
      '- Do not expand scope into a broader refactor or feature unless the user asks for one.'
    );
  }

  if (route.executionPath === 'resume_saved_plan') {
    lines.push(
      '',
      '## Saved plan handoff',
      options.savedPlanId
        ? `Resume active plan ${options.savedPlanId}. Do not replan unless the saved plan is impossible to execute.`
        : 'Resume the active saved plan. Do not replan unless the saved plan is impossible to execute.'
    );
  }

  lines.push(
    '',
    '## Scope',
    `Status: ${scope.status}`,
    `Reason: ${scope.reason}`,
  );
  if (scope.scopeRoot) lines.push(`Scope root: ${scope.scopeRoot}`);

  if (options.suggestedSkills?.length) {
    lines.push('', `Suggested skills: ${options.suggestedSkills.join(', ')}`);
  }
  if (options.appliedSkills?.length) {
    lines.push(`Applied skills: ${options.appliedSkills.join(', ')}`);
  }

  const configuredVerifyCommands = (options.verifyCommands ?? [])
    .map((command) => command.trim())
    .filter(Boolean);
  if (configuredVerifyCommands.length > 0) {
    lines.push('', '## Verification commands', ...configuredVerifyCommands.map((command) => `- ${command}`));
  }

  if (options.workspaceRoot) {
    const plan = resolveProjectVerifyCommands(
      options.workspaceRoot,
      configuredVerifyCommands,
      { userMessage }
    );
    lines.push('', formatVerifyPlanForAgent(plan));
  }

  if (catalog) {
    lines.push('', formatProjectCatalog(catalog));
  }

  lines.push('', '## Original Act request', userMessage);
  return lines.join('\n');
}
