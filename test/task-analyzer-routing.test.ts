import { describe, expect, it } from 'vitest';
import { analyzeTask } from '../src/features/ce/runtime/TaskAnalyzer';

describe('TaskAnalyzer routing regressions', () => {
  it('preserves deterministic Act intent metadata when no classifier intent is supplied', () => {
    expect(analyzeTask('Analyze session.jsonl', 'agent').actIntent).toBe('log_audit');
    expect(analyzeTask('add docs for all ffb-mui features', 'agent').actIntent).toBe('docs');
    expect(analyzeTask('find unused dependencies and clean up dead code', 'agent').actIntent).toBe('audit');
  });

  it('reconciles accepted Act intents with deterministic task analysis', () => {
    const diagnosis = analyzeTask('fix typo in src/auth.ts', 'agent', { actIntent: 'diagnose' });
    expect(diagnosis.kind).toBe('debugging');
    expect(diagnosis.shouldPlan).toBe(false);
    expect(diagnosis.shouldVerify).toBe(true);
    expect(diagnosis.actIntent).toBe('diagnose');

    const question = analyzeTask('How would you fix auth.ts?', 'agent', { actIntent: 'question' });
    expect(question.kind).toBe('question');
    expect(question.shouldPlan).toBe(false);
    expect(question.shouldVerify).toBe(false);
  });

  it('does not classify dependency-tool questions as cleanup audits', () => {
    for (const message of [
      'What is knip?',
      'Explain how depcheck works.',
      'Is ts-prune reliable?',
      'Show me where unused imports are detected.',
    ]) {
      const analysis = analyzeTask(message, 'agent');
      expect(analysis.kind).toBe('question');
      expect(analysis.shouldPlan).toBe(false);
      expect(analysis.shouldVerify).toBe(false);
    }
  });

  it('still classifies explicit dependency and dead-code cleanup requests as audits', () => {
    for (const message of [
      'Run knip',
      'Find unused imports',
      'Audit dependencies',
      'Can you remove all the unsed imports and files and dependencies from the entire project',
    ]) {
      const analysis = analyzeTask(message, 'agent');
      expect(analysis.kind).toBe('audit');
      expect(analysis.shouldUseSubagents).toBe(false);
    }
  });

  it('treats broad project repair requests as planned bugfix work', () => {
    const analysis = analyzeTask('Can you please fix all the issues in this project @ai-service', 'agent');

    expect(analysis.kind).toBe('implementation');
    expect(analysis.complexity).toBe('medium');
    expect(analysis.shouldPlan).toBe(true);
    expect(analysis.shouldVerify).toBe(true);
    expect(analysis.shouldUseSubagents).toBe(false);
    expect(analysis.subagentDecision?.reasonCodes).toContain('capture_baseline_first');
    expect(analysis.actIntent).toBe('bugfix');
    expect(analysis.summary).toContain('run one baseline check');
    expect(analysis.summary).toContain('current diagnostic files');
  });

  it('keeps deterministic high-complexity verification work on direct tools', () => {
    const analysis = analyzeTask(
      'Run tests, lint, typecheck, and build across the entire workspace, then report every failure and verification command result.',
      'agent'
    );

    expect(analysis.kind).toBe('implementation');
    expect(analysis.complexity).toBe('high');
    expect(analysis.shouldUseSubagents).toBe(false);
    expect(analysis.subagentDecision).toMatchObject({
      executionMode: 'single_agent',
      maxParallelAgents: 0,
      singleWriter: true,
      reasonCodes: ['independent_deterministic_work'],
    });
  });

  it('allows read-only subagents only for independent reasoning workstreams', () => {
    const analysis = analyzeTask(
      'Refactor frontend and backend authentication flows, compare migration options, update tests, and implement shared token handling across the whole codebase.',
      'agent'
    );

    expect(analysis.kind).toBe('implementation');
    expect(analysis.complexity).toBe('high');
    expect(analysis.shouldUseSubagents).toBe(true);
    expect(analysis.subagentDecision).toMatchObject({
      executionMode: 'parallel_readonly_agents',
      maxParallelAgents: 2,
      singleWriter: true,
    });
    expect(analysis.subagentDecision?.reasonCodes).toContain('independent_reasoning_workstreams');
    expect(analysis.subagentDecision?.reasonCodes).toContain('coordinator_single_writer');
  });
});
