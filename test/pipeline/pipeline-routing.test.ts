import { describe, expect, it } from 'vitest';
import {
  resolveTurnPipeline,
  resolveRoute,
  resolveAuditSubtype,
  resolveDocsSubtype,
  isDependencyCleanupAudit,
  resolveSkillsForRoute,
  resolveCapabilities,
  filterToolsByCapabilities,
  minStepsForAxis,
  resolvePlanningDepthAxis,
  buildRoutePolicyText,
  classifyArtifacts,
  classifyArtifactPath,
} from '../../src/features/ce/pipeline/index';
import { analyzeTask } from '../../src/features/ce/runtime/TaskAnalyzer';
import { resolveActSkillNames } from '../../src/features/ce/modes/agent/actSkillRouting';
import { shouldUsePlannerForAct } from '../../src/features/ce/modes/agent/ActIntentRouter';
import { minStepsForPlanningDepth } from '../../src/features/ce/plans/planningDepth';
import { resolveGitRoute } from '../../src/features/ce/git/intents';
import { shouldRunStructuredPlanner } from '../../src/features/ce/orchestration/ChatOrchestrator';

describe('pipeline route + subtypes', () => {
  it('extracts multiple explicit artifacts with normalized paths', () => {
    const result = classifyArtifacts(
      String.raw`Update C:\project\README.md and src/auth.ts, then inspect .mitii/logs`
    );
    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'readme', path: 'C:/project/README.md', source: 'explicit' }),
      expect.objectContaining({ kind: 'source_file', path: 'src/auth.ts', source: 'explicit' }),
      expect.objectContaining({ kind: 'log_directory', path: '.mitii/logs', source: 'explicit' }),
    ]));
  });

  it('classifies a specific .jsonl session log file distinctly from the logs directory', () => {
    expect(classifyArtifactPath('.mitii/logs/2026-07-19_19-44-53-abc.jsonl')).toBe('jsonl_file');
    expect(classifyArtifactPath('.mitii/logs')).toBe('log_directory');
    expect(classifyArtifactPath('.mitii/logs/')).toBe('log_directory');
  });

  it('classifies README requests as docs/readme and skips heavy planner', () => {
    const msg =
      'I need Readfile added for this project, which should include all the details, like structure, apis, payloads, Architecture';
    const analysis = analyzeTask(msg, 'agent', { actIntent: 'docs' });
    expect(analysis.kind).toBe('docs');
    expect(analysis.docsSubtype).toBe('readme');
    expect(analysis.shouldPlan).toBe(false);
    expect(shouldUsePlannerForAct(analysis, true, false, 'auto')).toBe(false);

    const route = resolveRoute(msg, analysis);
    expect(route.intent).toBe('docs');
    expect(route.docsSubtype).toBe('readme');
    expect(route.operationClass).toBe('workspace_write');
    expect(route.executionPath).toBe('direct');
    expect(resolvePlanningDepthAxis(route, analysis)).toBe('direct');
  });

  it('separates README inspection from README writes', () => {
    const explain = 'Explain the architecture described in README.md';
    const explainRoute = resolveRoute(explain, analyzeTask(explain, 'ask', {
      askIntent: 'explain_code',
    }));
    expect(explainRoute.intent).toBe('docs');
    expect(explainRoute.operationClass).toBe('inspect');

    const update = 'Update README.md with the current architecture';
    const updateRoute = resolveRoute(update, analyzeTask(update, 'agent', {
      actIntent: 'docs',
    }));
    expect(updateRoute.intent).toBe('docs');
    expect(updateRoute.operationClass).toBe('workspace_write');
  });

  it('does not treat prompt/security audits as depcheck cleanup', () => {
    expect(resolveAuditSubtype('Please run a prompt audit on our system prompts')).toBe('prompt');
    expect(resolveAuditSubtype('Security configuration review of CORS and auth')).toBe('security_config');
    expect(resolveAuditSubtype('Find unused dependencies with depcheck')).toBe('unused_deps');
  });

  it('does not treat unusual architecture as unused-code cleanup', async () => {
    const { isAuditCleanupTask } = await import('../../src/features/ce/runtime/taskKind');
    expect(isAuditCleanupTask('Review this unusual architecture')).toBe(false);
  });

  it('routes build restoration cleanup as a bugfix instead of generic audit cleanup', () => {
    const msg = 'Fix the build errors. The folder structure changes were half implemneted; cleanup unnecessary files, bring the project to its original state, and run it.';
    const analysis = analyzeTask(msg, 'agent');
    const route = resolveRoute(msg, analysis);

    expect(route.intent).toBe('bugfix');
    expect(route.auditSubtype).toBeUndefined();
    expect(route.operationClass).toBe('workspace_write');
    expect(route.risk).toBe('high');
    expect(route.executionPath).toBe('orchestrated');
    const pipeline = resolveTurnPipeline(msg, analysis, {
      mode: 'agent',
      orchestrationEnabled: true,
    });
    expect(analysis.shouldPlan).toBe(false);
    expect(pipeline.shouldUsePlanner).toBe(true);
    expect(pipeline.internalDepth).not.toBe('none');
    expect(shouldRunStructuredPlanner(
      pipeline.shouldUsePlanner,
      true,
      pipeline.internalDepth,
      'agent'
    )).toBe(true);
    expect(resolveSkillsForRoute(route, analysis).activeSkill).toBe('bugfix-workflow');
  });

  it('plans broad project repairs through the orchestrated bugfix loop when Agent depth is deep', () => {
    const msg = 'Can you please fix all the issues in this project @ai-service';
    const analysis = analyzeTask(msg, 'agent', { actIntent: 'feature' });
    const pipeline = resolveTurnPipeline(msg, analysis, {
      mode: 'agent',
      userDepth: 'deep',
      orchestrationEnabled: true,
    });

    expect(pipeline.route.intent).toBe('bugfix');
    expect(pipeline.route.executionPath).toBe('orchestrated');
    expect(pipeline.depthAxis).toBe('deep');
    expect(pipeline.internalDepth).toBe('full');
    expect(pipeline.shouldUsePlanner).toBe(true);
    expect(pipeline.skills.activeSkill).toBe('bugfix-workflow');
  });

  it('adds an evidence-first bugfix contract to route policy text', () => {
    const msg = 'Can you please fix all the issues in this project @ai-service';
    const analysis = analyzeTask(msg, 'agent');
    const route = resolveRoute(msg, analysis);
    const policy = buildRoutePolicyText(route);

    expect(policy).toContain('## Bugfix contract');
    expect(policy).toContain('Current build/test/runtime diagnostics outrank previous-session hypotheses');
    expect(policy).toContain('Run one baseline reproduction check');
    expect(policy).toContain('do not rerun equivalent checks before editing');
    expect(policy).toContain('Do not propose structural rewrites');
  });

  it('classifies @project mentions as structured project artifacts', () => {
    const msg = 'Can you please fix all the issues in this project @ai-service';
    const withoutCatalog = classifyArtifacts(msg);
    expect(withoutCatalog.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'project',
        path: 'ai-service',
        projectId: 'ai-service',
        source: 'explicit',
      }),
    ]));

    const withCatalog = classifyArtifacts(msg, {
      knownProjects: [
        { id: 'ai-service', root: 'ai-service', name: 'ai-service' },
        { id: 'frontend', root: 'frontend', name: 'frontend' },
      ],
    });
    expect(withCatalog.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'project',
        path: 'ai-service',
        projectId: 'ai-service',
        confidence: 1,
      }),
    ]));
    expect(withCatalog.artifacts.some((artifact) => artifact.projectId === 'frontend')).toBe(false);

    const pipeline = resolveTurnPipeline(msg, analyzeTask(msg, 'agent'), {
      mode: 'agent',
      orchestrationEnabled: true,
      knownProjects: [{ id: 'ai-service', root: 'ai-service', name: 'ai-service' }],
    });
    expect(pipeline.artifact.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'project', projectId: 'ai-service' }),
    ]));
  });

  it('does not silently resolve an @mention to one of two equally-scored catalog projects', () => {
    const result = classifyArtifacts('Please fix the bug in @api', {
      knownProjects: [
        { id: 'api-gateway', root: 'services/api-gateway', name: 'api-gateway' },
        { id: 'api-worker', root: 'services/api-worker', name: 'api-worker' },
      ],
    });
    // Neither catalog project scores higher than the other for "api" (substring match on both),
    // so this must fall back to the unresolved-mention path rather than guessing one of them.
    const projectMatch = result.artifacts.find((artifact) => artifact.kind === 'project');
    expect(projectMatch?.confidence).toBeLessThan(1);
    expect(['api-gateway', 'api-worker']).not.toContain(projectMatch?.projectId);
  });

  it('does not allow direct execution to carry deep planning depth', () => {
    const msg = 'fix typo in src/auth.ts';
    const analysis = analyzeTask(msg, 'agent');
    const pipeline = resolveTurnPipeline(msg, analysis, {
      mode: 'agent',
      userDepth: 'deep',
      orchestrationEnabled: true,
    });

    expect(pipeline.route.executionPath).toBe('direct');
    expect(pipeline.depthAxis).toBe('direct');
    expect(pipeline.internalDepth).toBe('micro');
    expect(pipeline.shouldUsePlanner).toBe(false);
  });

  it('resolves docs subtypes', () => {
    expect(resolveDocsSubtype('update the README')).toBe('readme');
    expect(resolveDocsSubtype('fix docusaurus sidebar')).toBe('docusaurus');
  });

  it('distinguishes a bare "audit" review from cleanup-shaped audits', () => {
    expect(resolveAuditSubtype('Audit our API authorization and fix the findings')).toBe('review');
    expect(isDependencyCleanupAudit('review')).toBe(false);
    expect(resolveAuditSubtype('Please clean up unused files in this repo')).toBe('generic');
    expect(isDependencyCleanupAudit('generic')).toBe(true);
  });

  it('does not force inspect when askIntent is present alongside a write-authorizing actIntent', () => {
    const route = resolveRoute('Explain what is broken, then fix it', {
      kind: 'implementation',
      complexity: 'low',
      shouldPlan: false,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: 'Explain what is broken, then fix it',
      askIntent: 'debug_explain',
      actIntent: 'bugfix',
    });
    expect(route.operationClass).not.toBe('inspect');
  });

  it('defaults unrecognized workspace mutations to medium risk, not low', () => {
    const route = resolveRoute('Please wire up the new integration module', {
      kind: 'implementation',
      complexity: 'medium',
      shouldPlan: false,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: 'Please wire up the new integration module',
      actIntent: 'feature',
    });
    expect(route.operationClass).toBe('workspace_write');
    expect(route.risk).toBe('medium');
  });

  it('resolves audit/diagnose fallback to inspect, never a shell pseudo-class', () => {
    const route = resolveRoute('Audit the architecture of this service', {
      kind: 'audit',
      complexity: 'medium',
      shouldPlan: false,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: 'Audit the architecture of this service',
      actIntent: 'audit',
    });
    expect(route.operationClass).toBe('inspect');
  });
});

describe('pipeline skills 0-1', () => {
  it('injects documentation skill for docs, not using-agent-skills', () => {
    const names = resolveActSkillNames('docs', {
      kind: 'docs',
      complexity: 'medium',
      summary: 'Create enterprise-level README files for ai-service and frontend',
      shouldPlan: false,
      shouldVerify: false,
      shouldUseSubagents: false,
      docsSubtype: 'readme',
      actIntent: 'docs',
    });
    expect(names).toEqual(['documentation']);
    expect(names).not.toContain('using-agent-skills');
    expect(names).not.toContain('test-driven-development');
  });

  it('keeps log-audit exclusive', () => {
    expect(resolveActSkillNames('log_audit')).toEqual(['log-audit']);
  });

  it('routes ask log analysis to log-audit, not performance-optimization', () => {
    const msg =
      'read all the logs and find out top 10 issues\n/Users/karthikshinde/Applications/resumeAI/.mitii/logs';
    const analysis = analyzeTask(msg, 'ask');
    expect(analysis.kind).toBe('log_audit');
    expect(analysis.askIntent).toBe('log_analysis');
    const pipeline = resolveTurnPipeline(msg, analysis, { mode: 'ask', userDepth: 'deep' });
    expect(pipeline.route.intent).toBe('log_audit');
    expect(pipeline.skills.activeSkill).toBe('log-audit');
    expect(pipeline.skills.activeSkill).not.toBe('performance-optimization');
  });

  it('does not inject git-history-analysis for Log viewer UI planning', () => {
    const msg =
      'What all things needs for build a Log viewer UI for\n/Users/karthikshinde/Applications/resumeAI/.mitii/logs\n- Should be developed in React';
    const analysis = analyzeTask(msg, 'plan');
    expect(analysis.kind).not.toBe('git');
    const pipeline = resolveTurnPipeline(msg, analysis, { mode: 'plan', planning: true });
    expect(pipeline.route.intent).not.toBe('git');
    expect(pipeline.skills.activeSkill).not.toBe('git-history-analysis');
  });

  it('injects git skill as active for commit messages', () => {
    const gitRoute = resolveGitRoute('generate a commit message for my staged changes', 'agent');
    const skills = resolveSkillsForRoute(
      resolveRoute('generate a commit message for my staged changes', {
        kind: 'git',
        complexity: 'low',
        summary: 'generate a commit message for my staged changes',
        shouldPlan: false,
        shouldVerify: false,
        shouldUseSubagents: false,
        gitRoute,
      }),
      {
        kind: 'git',
        complexity: 'low',
        summary: 'generate a commit message for my staged changes',
        shouldPlan: false,
        shouldVerify: false,
        shouldUseSubagents: false,
        gitRoute,
      }
    );
    expect(skills.injectSkills).toHaveLength(1);
    expect(skills.activeSkill).toBe('git-commit-message');
    expect(skills.deferredSkills).toContain('using-agent-skills');
  });

  it('does not default a bare Git-intent route with no taskAnalysis to test-driven-development', () => {
    const gitRoute: ReturnType<typeof resolveRoute> = {
      intent: 'git',
      risk: 'low',
      operationClass: 'inspect',
      executionPath: 'direct',
      isGitTask: true,
      summary: 'git route with no selected skill',
    };
    expect(resolveSkillsForRoute(gitRoute).activeSkill).not.toBe('test-driven-development');
  });

  it('does not default a non-cleanup audit subtype to test-driven-development', () => {
    const architectureAuditRoute = resolveRoute('Do an architecture audit of this service', {
      kind: 'audit',
      complexity: 'medium',
      shouldPlan: false,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: 'Do an architecture audit of this service',
      actIntent: 'audit',
      auditSubtype: 'architecture',
    });
    expect(
      resolveSkillsForRoute(architectureAuditRoute, undefined, 'Do an architecture audit of this service').activeSkill
    ).not.toBe('test-driven-development');
  });

  it('matches domain skills against the raw user message even when the task summary is generic', () => {
    const route = resolveRoute('add an accessible aria-labelled component with keyboard navigation', {
      kind: 'implementation',
      complexity: 'low',
      shouldPlan: false,
      shouldVerify: true,
      shouldUseSubagents: false,
      actIntent: 'feature',
      summary: 'Small targeted edit — execute directly with validation.',
    });
    const skills = resolveSkillsForRoute(
      route,
      undefined,
      'add an accessible aria-labelled component with keyboard navigation'
    );
    expect(skills.activeSkill).toBe('building-components');
  });
});

describe('pipeline capabilities + MCP', () => {
  it('preserves local versus remote Git write classes', () => {
    const commitMessage = 'Commit these changes';
    const commitGitRoute = resolveGitRoute(commitMessage, 'agent');
    const commitRoute = resolveRoute(commitMessage, {
      kind: 'git',
      complexity: 'low',
      shouldPlan: false,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: commitMessage,
      gitRoute: commitGitRoute,
    });
    expect(commitRoute.operationClass).toBe('local_git_write');

    const pullRequest = 'Push this branch and create a pull request';
    const prGitRoute = resolveGitRoute(pullRequest, 'agent');
    const prRoute = resolveRoute(pullRequest, {
      kind: 'git',
      complexity: 'medium',
      shouldPlan: true,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: pullRequest,
      gitRoute: prGitRoute,
    });
    expect(prRoute.operationClass).toBe('remote_write');
  });

  it('hides release_plan_controller and MCP filesystem on docs routes', () => {
    const route = resolveRoute('Write a README for frontend', {
      kind: 'docs',
      complexity: 'medium',
      shouldPlan: false,
      shouldVerify: false,
      shouldUseSubagents: false,
      summary: 'Write a README for frontend',
      docsSubtype: 'readme',
      actIntent: 'docs',
    });
    const caps = resolveCapabilities(route, { mode: 'agent', toolExposure: 'full' });
    expect(caps.excludedTools.has('release_plan_controller')).toBe(true);
    expect(caps.excludedTools.has('mark_step_complete')).toBe(true);
    expect(caps.excludedTools.has('mcp__filesystem__read_text_file')).toBe(true);
    expect(caps.mcpPolicy).toBe('no_filesystem');

    const tools = [
      { function: { name: 'write_file' } },
      { function: { name: 'release_plan_controller' } },
      { function: { name: 'mcp__filesystem__read_text_file' } },
      { function: { name: 'mcp__memory__search' } },
    ];
    const filtered = filterToolsByCapabilities(tools, caps).map((t) => t.function.name);
    expect(filtered).toContain('write_file');
    expect(filtered).toContain('mcp__memory__search');
    expect(filtered).not.toContain('release_plan_controller');
    expect(filtered).not.toContain('mcp__filesystem__read_text_file');
  });

  it('keeps Git read tools available on a read-only Git route but still hides write/release tools', () => {
    const inspectRoute = {
      intent: 'git' as const,
      risk: 'low' as const,
      operationClass: 'inspect' as const,
      executionPath: 'direct' as const,
      isGitTask: true,
      summary: 'inspect git route',
    };
    const caps = resolveCapabilities(inspectRoute, { mode: 'agent', toolExposure: 'full' });
    expect(caps.excludedTools.has('github_verify_repository')).toBe(false);
    expect(caps.excludedTools.has('discover_github_workflows')).toBe(false);
    expect(caps.excludedTools.has('git_commit')).toBe(true);
    expect(caps.excludedTools.has('release_plan_controller')).toBe(true);
  });

  it('hides Git read tools entirely on a non-Git route', () => {
    const featureRoute = {
      intent: 'feature' as const,
      risk: 'medium' as const,
      operationClass: 'workspace_write' as const,
      executionPath: 'direct' as const,
      isGitTask: false,
      summary: 'non-git feature route',
    };
    const caps = resolveCapabilities(featureRoute, { mode: 'agent', toolExposure: 'full' });
    expect(caps.excludedTools.has('github_verify_repository')).toBe(true);
    expect(caps.excludedTools.has('git_commit')).toBe(true);
  });

  it('never leaks Git write/release tools on a non-Git route even if operationClass claims remote_write', () => {
    // Defensive regression: resolveRoute() never actually produces this combination today,
    // but resolveCapabilities is a public function and must not trust operationClass alone.
    const malformedRoute = {
      intent: 'feature' as const,
      risk: 'high' as const,
      operationClass: 'remote_write' as const,
      executionPath: 'direct' as const,
      isGitTask: false,
      summary: 'non-git route incorrectly tagged remote_write',
    };
    const caps = resolveCapabilities(malformedRoute, { mode: 'agent', toolExposure: 'full' });
    expect(caps.excludedTools.has('git_commit')).toBe(true);
    expect(caps.excludedTools.has('release_plan_controller')).toBe(true);
    expect(caps.excludedTools.has('github_create_release')).toBe(true);
  });

  it('returns a fully locked-down read-only policy when the provider does not support tools', () => {
    const route = resolveRoute('fix the bug', {
      kind: 'implementation',
      complexity: 'low',
      shouldPlan: false,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: 'fix the bug',
      actIntent: 'bugfix',
    });
    const caps = resolveCapabilities(route, { mode: 'agent', supportsTools: false });
    expect(caps.approvalProfile).toBe('read_only');
    expect(caps.mcpPolicy).toBe('none');
    expect(caps.maxProposeFileScopePerStep).toBe(0);
  });
});

describe('pipeline planning depth', () => {
  it('no longer forces 8 audit steps', () => {
    expect(
      minStepsForPlanningDepth('full', {
        kind: 'audit',
        complexity: 'high',
        shouldPlan: true,
        shouldVerify: true,
        shouldUseSubagents: false,
        summary: 'unused dependencies',
        auditSubtype: 'unused_deps',
      })
    ).toBeLessThan(8);

    const route = resolveRoute('unused dependencies cleanup', {
      kind: 'audit',
      complexity: 'high',
      shouldPlan: true,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: 'unused dependencies',
      auditSubtype: 'unused_deps',
    });
    expect(minStepsForAxis('deep', route)).toBe(4);
  });

  it('resolveTurnPipeline wires README to direct + documentation skill', () => {
    const msg = 'Add a README with architecture and APIs for the frontend';
    const analysis = analyzeTask(msg, 'agent');
    const pipeline = resolveTurnPipeline(msg, analysis, {
      mode: 'agent',
      toolExposure: 'full',
      orchestrationEnabled: true,
    });
    expect(pipeline.route.intent).toBe('docs');
    expect(pipeline.route.operationClass).toBe('workspace_write');
    expect(pipeline.depthAxis).toBe('direct');
    expect(pipeline.shouldUsePlanner).toBe(false);
    expect(pipeline.skills.activeSkill).toBe('documentation');
    expect(pipeline.capabilities.excludedTools.has('release_plan_controller')).toBe(true);
  });
});
