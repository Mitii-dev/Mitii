import { describe, expect, it } from 'vitest';
import {
  resolveTurnPipeline,
  resolveRoute,
  resolveAuditSubtype,
  resolveDocsSubtype,
  resolveSkillsForRoute,
  resolveCapabilities,
  filterToolsByCapabilities,
  minStepsForAxis,
  resolvePlanningDepthAxis,
  classifyArtifacts,
} from '../../src/features/ce/pipeline/index';
import { analyzeTask } from '../../src/features/ce/runtime/TaskAnalyzer';
import { resolveActSkillNames } from '../../src/features/ce/modes/agent/actSkillRouting';
import { shouldUsePlannerForAct } from '../../src/features/ce/modes/agent/ActIntentRouter';
import { minStepsForPlanningDepth } from '../../src/features/ce/plans/planningDepth';
import { resolveGitRoute } from '../../src/features/ce/git/intents';

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
    expect(resolveTurnPipeline(msg, analysis, {
      mode: 'agent',
      orchestrationEnabled: true,
    }).shouldUsePlanner).toBe(true);
    expect(resolveSkillsForRoute(route, analysis).activeSkill).toBe('bugfix-workflow');
  });

  it('resolves docs subtypes', () => {
    expect(resolveDocsSubtype('update the README')).toBe('readme');
    expect(resolveDocsSubtype('fix docusaurus sidebar')).toBe('docusaurus');
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
