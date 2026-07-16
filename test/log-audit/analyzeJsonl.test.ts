import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { analyzeJsonlFile, analyzeLogDirectory } from '../../src/core/runtime/logAudit';
import { IgnoreService } from '../../src/core/indexing/IgnoreService';
import { createAnalyzeJsonlTool, createAnalyzeLogDirectoryTool } from '../../src/core/tools/logAuditTools';

describe('analyzeJsonlFile', () => {
  it('parses compact session metrics without embedding raw content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-jsonl-'));
    const path = join(dir, 'sample.jsonl');
    const lines = [
      JSON.stringify({
        type: 'session_start',
        time: '2026-07-16T14:41:14.000Z',
        sessionId: 'abc',
        message: 'start',
        data: { model: 'qwen', mode: 'agent' },
      }),
      JSON.stringify({
        type: 'tool_start',
        time: '2026-07-16T14:41:15.000Z',
        sessionId: 'abc',
        message: 'read_file',
        data: { tool: 'read_file', path: 'a.jsonl' },
      }),
      JSON.stringify({
        type: 'tool_end',
        time: '2026-07-16T14:41:16.000Z',
        sessionId: 'abc',
        message: 'read_file',
        data: { tool: 'read_file', path: 'a.jsonl', success: true },
      }),
      JSON.stringify({
        type: 'tool_end',
        time: '2026-07-16T14:41:17.000Z',
        sessionId: 'abc',
        message: 'read_file',
        data: { tool: 'read_file', path: 'a.jsonl', success: true },
      }),
      JSON.stringify({
        type: 'token_usage',
        time: '2026-07-16T14:41:18.000Z',
        sessionId: 'abc',
        message: 'AI call',
        data: { inputTokens: 1000, outputTokens: 50, currentTurnTotal: 5000 },
      }),
      JSON.stringify({
        type: 'token_usage',
        time: '2026-07-16T14:41:19.000Z',
        sessionId: 'abc',
        message: 'AI call',
        data: { inputTokens: 2000, outputTokens: 80, currentTurnTotal: 8000 },
      }),
    ];
    writeFileSync(path, `${lines.join('\n')}\n`, 'utf-8');

    const report = await analyzeJsonlFile(path, 'sample.jsonl');
    expect(report.file.lines).toBe(6);
    expect(report.tokens.modelCalls).toBe(2);
    expect(report.tokens.maxInputPerCall).toBe(2000);
    expect(report.tokens.cumulativeTotal).toBe(8000);
    expect(report.tokens.inputTotal).toBe(3000);
    expect(report.tools.counts.read_file).toBeGreaterThanOrEqual(1);
    expect(report.tools.duplicateSignatures.length).toBeGreaterThan(0);
    expect(report.hasEnoughEvidence).toBe(true);
    expect(JSON.stringify(report).length).toBeLessThan(12_000);

    unlinkSync(path);
  });

  it('does not count a normal tool_start/tool_end pair as a duplicate operation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-jsonl-dupes-'));
    try {
      const path = join(dir, 'single-tool.jsonl');
      const lines = [
        JSON.stringify({
          type: 'tool_start',
          time: '2026-07-16T14:41:15.000Z',
          sessionId: 'abc',
          message: 'read_file',
          data: { tool: 'read_file', path: 'src/index.ts' },
        }),
        JSON.stringify({
          type: 'tool_end',
          time: '2026-07-16T14:41:16.000Z',
          sessionId: 'abc',
          message: 'read_file',
          data: { tool: 'read_file', path: 'src/index.ts', success: true },
        }),
      ];
      writeFileSync(path, `${lines.join('\n')}\n`, 'utf-8');

      const report = await analyzeJsonlFile(path, 'single-tool.jsonl');
      expect(report.tools.counts.read_file).toBe(1);
      expect(report.tools.duplicateSignatures).toEqual([]);
      expect(report.anomalies.some((item) => item.includes('Repeated tool signature'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks terminal logs with mid-sentence assistant output as truncated, not complete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-jsonl-truncated-'));
    try {
      const path = join(dir, 'truncated.jsonl');
      const lines = [
        JSON.stringify({
          type: 'session_start',
          time: '2026-07-16T14:41:14.000Z',
          sessionId: 'truncated',
          message: 'start',
          data: { model: 'qwen', mode: 'ask' },
        }),
        JSON.stringify({
          type: 'assistant_message',
          time: '2026-07-16T14:41:15.000Z',
          sessionId: 'truncated',
          message: 'This response has enough text to look substantial, but it ends while explaining the next important',
          data: {},
        }),
        JSON.stringify({
          type: 'session_end',
          time: '2026-07-16T14:41:16.000Z',
          sessionId: 'truncated',
          message: 'Session completed',
          data: { hadError: false },
        }),
      ];
      writeFileSync(path, `${lines.join('\n')}\n`, 'utf-8');

      const report = await analyzeJsonlFile(path, 'truncated.jsonl');
      expect(report.session.completed).toBe(false);
      expect(report.session.completionStatus).toBe('truncated');
      expect(report.anomalies[0]).toContain('Response appears truncated');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('analyzes a log directory in one call with aggregate totals and inclusion reasons', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mitii-log-dir-'));
    try {
      const logDir = join(workspace, '.mitii', 'logs');
      mkdirSync(logDir, { recursive: true });
      const completePath = join(logDir, 'complete.jsonl');
      const activePath = join(logDir, 'active.jsonl');
      writeFileSync(completePath, `${[
        JSON.stringify({
          type: 'session_start',
          time: '2026-07-16T14:41:14.000Z',
          sessionId: 'complete',
          message: 'start',
          data: { model: 'qwen', mode: 'ask' },
        }),
        JSON.stringify({
          type: 'tool_end',
          time: '2026-07-16T14:41:15.000Z',
          sessionId: 'complete',
          message: 'read_file',
          data: { tool: 'read_file', path: 'a.ts', success: false, error: 'File not found' },
        }),
        JSON.stringify({
          type: 'token_usage',
          time: '2026-07-16T14:41:16.000Z',
          sessionId: 'complete',
          message: 'AI call',
          data: { inputTokens: 10, outputTokens: 5 },
        }),
        JSON.stringify({
          type: 'session_end',
          time: '2026-07-16T14:41:17.000Z',
          sessionId: 'complete',
          message: 'Session completed',
          data: { hadError: true },
        }),
      ].join('\n')}\n`, 'utf-8');
      writeFileSync(activePath, `${JSON.stringify({
        type: 'session_start',
        time: '2026-07-16T14:42:14.000Z',
        sessionId: 'active',
        message: 'start',
        data: { model: 'qwen', mode: 'ask' },
      })}\n`, 'utf-8');

      const report = await analyzeLogDirectory(logDir, '.mitii/logs/', { activeLogPath: activePath });
      expect(report.totals.filesListed).toBe(2);
      expect(report.totals.filesIncluded).toBe(1);
      expect(report.totals.filesExcluded).toBe(1);
      expect(report.totals.failedToolCalls).toBe(1);
      expect(report.tokens.inputTotal).toBe(10);
      expect(report.errorCategories[0]).toMatchObject({ category: 'missing_path_or_resource', count: 1 });
      expect(report.files.find((file) => file.path.endsWith('active.jsonl'))).toMatchObject({
        included: false,
        active: true,
        reason: 'excluded: active session log',
      });

      const ignore = new IgnoreService();
      ignore.load(workspace);
      const tool = createAnalyzeLogDirectoryTool(workspace, ignore, () => activePath);
      const toolResult = await tool.execute({ path: '.mitii/logs/' });
      expect(toolResult.success).toBe(true);
      expect(toolResult.output).toContain('"filesListed": 2');
      expect(toolResult.output).toContain('[hasEnoughEvidence=true]');

      const typoToolResult = await tool.execute({ path: '.mtii/logs' });
      expect(typoToolResult.success).toBe(true);
      expect(typoToolResult.output).toContain('"path": ".mitii/logs/');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('allows analyze_jsonl to read ignored session log locations safely', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mitii-log-tool-'));
    try {
      const mitiiLogDir = join(workspace, '.mitii', 'logs');
      const rootLogDir = join(workspace, 'logs');
      mkdirSync(mitiiLogDir, { recursive: true });
      mkdirSync(rootLogDir, { recursive: true });

      const logLine = JSON.stringify({
        type: 'session_start',
        time: '2026-07-16T14:41:14.000Z',
        sessionId: 'abc',
        message: 'start',
        data: { model: 'qwen', mode: 'ask' },
      });
      writeFileSync(join(mitiiLogDir, 'session.jsonl'), `${logLine}\n`, 'utf-8');
      writeFileSync(join(rootLogDir, 'external-session.jsonl'), `${logLine}\n`, 'utf-8');

      const ignore = new IgnoreService();
      ignore.load(workspace);
      const tool = createAnalyzeJsonlTool(workspace, ignore);

      const canonical = await tool.execute({ path: '.mitii/logs/session.jsonl' });
      expect(canonical.success).toBe(true);
      expect(canonical.output).toContain('"path": ".mitii/logs/session.jsonl"');

      const typo = await tool.execute({ path: '.miti/logs/session.jsonl' });
      expect(typo.success).toBe(true);
      expect(typo.output).toContain('"path": ".mitii/logs/session.jsonl"');

      const omittedLetterTypo = await tool.execute({ path: '.mtii/logs/session.jsonl' });
      expect(omittedLetterTypo.success).toBe(true);
      expect(omittedLetterTypo.output).toContain('"path": ".mitii/logs/session.jsonl"');

      const rootLogs = await tool.execute({ path: 'logs/external-session.jsonl' });
      expect(rootLogs.success).toBe(true);
      expect(rootLogs.output).toContain('"path": "logs/external-session.jsonl"');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
