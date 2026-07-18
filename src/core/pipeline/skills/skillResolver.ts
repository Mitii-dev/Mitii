import type { TaskAnalysis } from '../../runtime/TaskAnalyzer';
import type { RouteResolution, SkillResolution } from '../types';
import { isDependencyCleanupAudit } from '../route/routeResolver';

/**
 * Resolve 0–1 active skill for injection. Meta skill `using-agent-skills` is never
 * auto-injected — it remains available via use_skill / deferred catalog.
 */
export function resolveSkillsForRoute(
  route: RouteResolution,
  taskAnalysis?: TaskAnalysis,
  options: { sourceMode?: 'ask' | 'plan' | 'agent'; planning?: boolean } = {}
): SkillResolution {
  if (route.intent === 'log_audit' || route.executionPath === 'log_audit') {
    return {
      activeSkill: 'log-audit',
      deferredSkills: [],
      suggestedSkills: ['log-audit'],
      injectSkills: ['log-audit'],
    };
  }

  const deferred: string[] = [];
  let active: string | undefined;

  // Planning sessions: one planning skill, not meta + planning + agent-plan stacked.
  if (options.planning) {
    active = options.sourceMode === 'agent' ? 'agent-plan' : 'planning-and-task-breakdown';
    deferred.push('planning-and-task-breakdown', 'agent-plan');
  }

  if (route.isGitTask && taskAnalysis?.gitRoute) {
    const git = taskAnalysis.gitRoute;
    const injected =
      git.selectedSkills.injected.length > 0
        ? git.selectedSkills.injected
        : git.selectedSkills.primarySkill
          ? [git.selectedSkills.primarySkill, ...git.selectedSkills.additionalSkills]
          : [];
    if (injected.length > 0) {
      // Git wins as the active domain skill when present.
      active = injected[0];
      deferred.push(...injected.slice(1));
    }
  }

  if (route.intent === 'docs') {
    active = active && options.planning ? active : 'documentation';
    if (active !== 'documentation') deferred.push('documentation');
  } else if (route.intent === 'audit' && isDependencyCleanupAudit(route.auditSubtype)) {
    if (!active || !options.planning) active = 'audit-cleanup';
    else deferred.push('audit-cleanup');
  } else if (route.intent === 'audit' && route.auditSubtype === 'code_quality') {
    if (!active || !options.planning) active = 'code-review-and-quality';
    else deferred.push('code-review-and-quality');
  } else if (route.intent === 'audit' && route.auditSubtype === 'git_history') {
    if (!active || !options.planning) active = 'git-history-analysis';
    else deferred.push('git-history-analysis');
  } else if (
    route.intent === 'bugfix' ||
    route.intent === 'diagnose' ||
    /\b(error|failing|failed|debug|repair|fix)\b/i.test(taskAnalysis?.summary ?? '')
  ) {
    if (!active || !options.planning) active = 'debugging-and-error-recovery';
    else deferred.push('debugging-and-error-recovery');
  }

  const summary = taskAnalysis?.summary ?? '';
  if (/\b(code review|review (this|the|my) (pr|pull request|diff|change)|quality gate)\b/i.test(summary)) {
    if (!active || !options.planning) active = 'code-review-and-quality';
    else deferred.push('code-review-and-quality');
  }
  // Do not match Ask "deep profile" summaries — require real perf language / profiling.
  if (/\b(performance|slow|latency|core web vitals|bundle size|profiling)\b/i.test(summary)) {
    if (!active || !options.planning) active = 'performance-optimization';
    else deferred.push('performance-optimization');
  }
  if (/\b(console\.log|inline style|tech debt|code smells?)\b/i.test(summary)) {
    deferred.push('code-smells-and-tech-debt');
  }
  if (/\b(\.env|environment variable|secrets?|api keys?)\b/i.test(summary)) {
    deferred.push('environment-and-secrets');
  }
  if (/\b(browser|puppeteer|screenshot)\b/i.test(summary)) {
    deferred.push('browser-testing-with-devtools');
  }
  if (
    !options.planning &&
    route.intent !== 'docs' &&
    route.intent !== 'question' &&
    (route.intent === 'feature' || route.intent === 'refactor' || route.intent === 'bugfix')
  ) {
    if (!active) {
      active =
        route.intent === 'bugfix'
          ? 'debugging-and-error-recovery'
          : 'test-driven-development';
    } else if (active !== 'test-driven-development') {
      deferred.push('test-driven-development');
    }
  }

  // If still nothing active for a non-trivial agent turn, prefer TDD over meta skill.
  if (!active && !options.planning && route.intent !== 'question') {
    active = 'test-driven-development';
  }

  // Meta skill is always deferred (discoverable), never the active injection.
  deferred.push('using-agent-skills');

  const deferredUnique = [...new Set(deferred.filter((s) => s !== active))];
  const injectSkills = active ? [active] : [];

  return {
    activeSkill: active,
    deferredSkills: deferredUnique,
    suggestedSkills: active ? [active, ...deferredUnique] : deferredUnique,
    injectSkills,
  };
}
