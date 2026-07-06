import type { AskScopeResolution, ProjectCatalog } from '../ask/askTypes';
import { resolveAskScope } from '../ask/AskScopeResolver';
import { createLogger } from '../../telemetry/Logger';

const log = createLogger('PlanScopeResolver');

export function resolvePlanScope(userMessage: string, catalog?: ProjectCatalog): AskScopeResolution {
  const scope = resolveAskScope(userMessage, catalog);
  log.debug('Resolved plan scope', {
    status: scope.status,
    reason: scope.reason,
    projects: scope.projects.map((project) => project.id),
  });
  return scope;
}
