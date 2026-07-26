import { describe, expect, it } from 'vitest';
import {
  LOG_AUDIT_SKIP_RETRIEVAL_SOURCES,
  LOG_AUDIT_ALLOWED_TOOLS,
  buildLogAuditBootstrapBlock,
  isLogAuditTask,
  extractLogAuditTargetPath,
} from '../../src/features/ce/runtime/logAudit';
import { routeAskIntent } from '../../src/features/ce/modes/ask';

describe('logAudit routing', () => {
  it('detects explicit jsonl analysis requests', () => {
    const text =
      'Analyze this session log and explain token waste: .mitii/logs/2026-07-16_14-41-14-c0552325-9f45-4960-ab49-34ef0dae5bce.jsonl';
    expect(isLogAuditTask(text)).toBe(true);
    expect(extractLogAuditTargetPath(text)).toContain('14-41-14');
  });

  it('does not treat dependency audits as log audits', () => {
    expect(isLogAuditTask('Audit unused dependencies with depcheck')).toBe(false);
  });

  it('detects tool_start / session log phrasing with a jsonl path', () => {
    expect(
      isLogAuditTask('Look at tool_start events in reports/run.jsonl and summarize failures')
    ).toBe(true);
  });

  it('detects .mitii/logs directory improvement asks (including analysis typo)', () => {
    const text =
      'Can you analysis this and provide me what all can be imporved ?\n/Users/karthikshinde/Applications/resumeAI/.mitii/logs';
    expect(isLogAuditTask(text)).toBe(true);
    expect(extractLogAuditTargetPath(text)).toMatch(/\.mitii\/logs\/?$/);
  });

  it('detects relative .mitii/logs without trailing slash', () => {
    expect(isLogAuditTask('Review .mitii/logs and summarize failures')).toBe(true);
    expect(extractLogAuditTargetPath('Please inspect .mitii/logs')).toBe('.mitii/logs/');
  });

  it('does not treat building a Log viewer UI as log audit', () => {
    const text =
      'What all things needs for build a Log viewer UI for\n/Users/karthikshinde/Applications/resumeAI/.mitii/logs\n- Should be developed in React';
    expect(isLogAuditTask(text)).toBe(false);
    expect(routeAskIntent(text).intent).not.toBe('log_analysis');
  });

  it('uses a dedicated Ask intent for log analysis', () => {
    expect(routeAskIntent('Review .mitii/logs and summarize failures')).toMatchObject({
      intent: 'log_analysis',
      shouldUseSubagents: false,
    });
  });

  it('routes directory analysis to analyze_log_directory while keeping read-only recovery tools available', () => {
    expect(LOG_AUDIT_ALLOWED_TOOLS.has('analyze_jsonl')).toBe(true);
    expect(LOG_AUDIT_ALLOWED_TOOLS.has('analyze_log_directory')).toBe(true);
    expect(LOG_AUDIT_ALLOWED_TOOLS.has('query_log_events')).toBe(true);
    expect(LOG_AUDIT_ALLOWED_TOOLS.has('list_files')).toBe(true);
    expect(LOG_AUDIT_ALLOWED_TOOLS.has('run_command')).toBe(true);
    expect(LOG_AUDIT_ALLOWED_TOOLS.has('use_skill')).toBe(true);
    expect(LOG_AUDIT_ALLOWED_TOOLS.has('write_file')).toBe(false);
    expect(LOG_AUDIT_ALLOWED_TOOLS.has('apply_patch')).toBe(false);
    expect(buildLogAuditBootstrapBlock('.mitii/logs/')).toContain('analyze_log_directory({ path })');
    expect(buildLogAuditBootstrapBlock('.mitii/logs/')).toContain('Read-only inspection tools');
  });

  it('skips every registered repo/context source for log audits', () => {
    expect([...LOG_AUDIT_SKIP_RETRIEVAL_SOURCES].sort()).toEqual([
      'auto-memory',
      'call-graph',
      'current-editor',
      'diagnostics',
      'fts',
      'git-diff',
      'indexed-file-search',
      'memory',
      'mentioned-files',
      'open-files',
      'project-catalog',
      'project-rules',
      'repo-map',
      'skill-catalog',
      'vector',
      'workspace-overview',
    ]);
  });
});
