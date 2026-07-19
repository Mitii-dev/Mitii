import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AuditPackBuilder, verifyAuditPack } from '../src/features/ce/audit';

describe('AuditPackBuilder', () => {
  it('builds a zip with expected entries and redacts secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-audit-test-'));
    try {
      const logPath = join(dir, 'session.jsonl');
      writeFileSync(logPath, JSON.stringify({
        ts: 1,
        type: 'tool_end',
        data: { apiKey: 'sk-abc1234567890', output: 'file contents' },
      }) + '\n');
      const result = new AuditPackBuilder().build({
        sessionId: 's1',
        workspace: dir,
        extensionVersion: '1.0.0',
        logPath,
        summaryMarkdown: '# Summary',
        toolAudit: [],
        stripFileContents: true,
      });

      const zipText = result.buffer.toString('latin1');
      expect(result.entries).toEqual([
        'session.jsonl',
        'summary.md',
        'manifest.json',
        'tool-audit.json',
        'approvals.json',
        'redaction-report.json',
        'signature.json',
      ]);
      expect(result.buffer.slice(0, 2).toString()).toBe('PK');
      expect(zipText).toContain('session.jsonl');
      expect(zipText).toContain('[REDACTED]');
      expect(zipText).not.toContain('sk-abc1234567890');
      expect(result.redactionReport.secretKeyRedactions).toBeGreaterThan(0);
      expect(verifyAuditPack(result.buffer).ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects signed audit pack tampering', () => {
    const result = new AuditPackBuilder().build({
      sessionId: 's1',
      workspace: process.cwd(),
      extensionVersion: '1.0.0',
      summaryMarkdown: '# Summary',
      signingKey: 'enterprise-secret',
    });
    expect(verifyAuditPack(result.buffer, 'enterprise-secret').ok).toBe(true);

    const tampered = Buffer.from(result.buffer);
    const idx = tampered.indexOf('Summary');
    tampered.write('Tamper!', idx, 'utf8');
    const verification = verifyAuditPack(tampered, 'enterprise-secret');
    expect(verification.ok).toBe(false);
    expect(verification.errors.some((error) => error.includes('hash mismatch'))).toBe(true);
  });
});
