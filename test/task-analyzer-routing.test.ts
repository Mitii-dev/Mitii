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
});
