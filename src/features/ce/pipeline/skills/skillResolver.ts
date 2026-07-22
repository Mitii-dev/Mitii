import type { TaskAnalysis } from '../../runtime/TaskAnalyzer';
import type { RouteResolution, SkillResolution } from '../types';
import { isDependencyCleanupAudit, isRepositoryRestorationBugfix } from '../route/routeResolver';

const TDD_ELIGIBLE_INTENTS = new Set<RouteResolution['intent']>(['feature', 'refactor', 'bugfix']);

/**
 * Resolve 0–1 active skill for injection. Meta skill `using-agent-skills` is never
 * auto-injected — it remains available via use_skill / deferred catalog.
 */
export function resolveSkillsForRoute(
  route: RouteResolution,
  taskAnalysis?: TaskAnalysis,
  userMessage = '',
  options: { sourceMode?: 'ask' | 'plan' | 'agent' | 'review'; planning?: boolean } = {}
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

  const planningSupportSkill = options.planning
    ? options.sourceMode === 'agent'
      ? 'agent-plan'
      : 'planning-and-task-breakdown'
    : undefined;

  // Match against the raw request too, not just taskAnalysis.summary — TaskAnalyzer often
  // produces a generic boilerplate summary (e.g. "Small targeted edit — execute directly")
  // that drops the domain keywords (aria, hero section, profiling, ...) a skill trigger needs.
  const searchableText = [userMessage, taskAnalysis?.summary].filter(Boolean).join('\n');

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
  } else if (route.intent === 'audit' && (route.auditSubtype === 'code_quality' || route.auditSubtype === 'review')) {
    if (!active || !options.planning) active = 'code-review-and-quality';
    else deferred.push('code-review-and-quality');
  } else if (route.intent === 'audit' && route.auditSubtype === 'git_history') {
    if (!active || !options.planning) active = 'git-history-analysis';
    else deferred.push('git-history-analysis');
  } else if (
    route.intent === 'bugfix' ||
    route.intent === 'diagnose' ||
    /\b(error|failing|failed|debug|repair|fix)\b/i.test(searchableText)
  ) {
    const bugfixSkill = route.intent === 'bugfix' || isRepositoryRestorationBugfix(searchableText)
      ? 'bugfix-workflow'
      : 'debugging-and-error-recovery';
    if (!active || !options.planning) active = bugfixSkill;
    else deferred.push(bugfixSkill);
  }

  const summary = searchableText;
  const componentWork =
    /\b(component library|ui component|component api|accessible component|aria|keyboard navigation|design tokens?|aschild|polymorphic|controlled|uncontrolled|registry component)\b/i.test(summary);
  const visualDesignWork =
    /\b(redesign|visual design|ui polish|frontend design|landing page|hero section|responsive polish|make (?:it|this).*(?:polished|beautiful|modern))\b/i.test(summary);
  const reactNextPerformanceWork =
    /\b(react|next\.?js|server components?|rsc|hydration|rerenders?|next\/dynamic)\b/i.test(summary) &&
    /\b(performance|slow|latency|core web vitals|bundle size|profiling|waterfall|hydration|rerenders?)\b/i.test(summary);

  if (componentWork) {
    if (!active || (!options.planning && (route.intent === 'feature' || route.intent === 'refactor'))) active = 'building-components';
    else deferred.push('building-components');
  }
  if (visualDesignWork) {
    if (!active || (!options.planning && (route.intent === 'feature' || route.intent === 'refactor'))) active = 'frontend-design';
    else deferred.push('frontend-design');
  }
  if (/\b(code review|review (this|the|my) (pr|pull request|diff|change)|quality gate)\b/i.test(summary)) {
    if (!active || !options.planning) active = 'code-review-and-quality';
    else deferred.push('code-review-and-quality');
  }
  // Do not match Ask "deep profile" summaries — require real perf language / profiling.
  if (/\b(performance|slow|latency|core web vitals|bundle size|profiling|waterfall|hydration|rerenders?)\b/i.test(summary)) {
    const performanceSkill = reactNextPerformanceWork ? 'react-next-performance' : 'performance-optimization';
    const supportingPerformanceSkill = reactNextPerformanceWork ? 'performance-optimization' : undefined;
    if (!active || !options.planning) active = performanceSkill;
    else deferred.push(performanceSkill);
    if (supportingPerformanceSkill && supportingPerformanceSkill !== active) deferred.push(supportingPerformanceSkill);
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

  // Planning is workflow support. Domain skills (bugfix/docs/git/etc.) remain
  // primary so their task-specific process is not displaced by the planner.
  if (planningSupportSkill) {
    if (!active) active = planningSupportSkill;
    else if (options.sourceMode === 'agent' && active !== planningSupportSkill) deferred.push(planningSupportSkill);
    deferred.push(
      planningSupportSkill === 'agent-plan'
        ? 'planning-and-task-breakdown'
        : 'agent-plan'
    );
  }
  // TDD/bugfix-workflow only applies to build-something-new-or-fix-it intents. Routes like
  // 'audit' (non-cleanup subtypes), 'git', 'greeting', or 'spike' have their own workflows
  // (or none) and must not silently inherit a test-first playbook that doesn't fit them.
  if (!options.planning && TDD_ELIGIBLE_INTENTS.has(route.intent)) {
    if (!active) {
      active =
        route.intent === 'bugfix'
          ? 'bugfix-workflow'
          : 'test-driven-development';
    } else if (active !== 'test-driven-development') {
      deferred.push('test-driven-development');
    }
  }

  // Meta skill is always deferred (discoverable), never the active injection.
  deferred.push('using-agent-skills');

  const deferredUnique = [...new Set(deferred.filter((s) => s !== active))];
  const supportingSkill =
    options.planning && planningSupportSkill && active && active !== planningSupportSkill && deferredUnique.includes(planningSupportSkill)
      ? planningSupportSkill
      : undefined;
  const injectSkills = active
    ? [active, supportingSkill].filter((skill): skill is string => Boolean(skill))
    : [];

  return {
    activeSkill: active,
    supportingSkill,
    deferredSkills: deferredUnique,
    suggestedSkills: active ? [active, ...deferredUnique] : deferredUnique,
    injectSkills,
  };
}
