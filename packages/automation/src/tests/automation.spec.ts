import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getNextCronIso, parseCron, validateCronPattern } from '../cron/next.js';
import { materializeDueRuns } from '../materializer.js';
import { AutomationService } from '../service.js';
import { SqliteAutomationStore } from '../store/sqliteStore.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('cron parse/next', () => {
  it('parses five-field expressions', () => {
    const parsed = parseCron('*/15 9-17 * * MON-FRI');
    expect(parsed.minutes).toContain(0);
    expect(parsed.minutes).toContain(15);
    expect(parsed.hours[0]).toBe(9);
    expect(parsed.hours.at(-1)).toBe(17);
    expect(parsed.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects bad patterns', () => {
    expect(() => validateCronPattern('0 9 * *')).toThrow(/5 fields/);
  });

  it('returns a next time after now', () => {
    const after = Date.parse('2026-08-30T12:00:00.000Z');
    const next = getNextCronIso('0 0 * * *', after);
    expect(Date.parse(next)).toBeGreaterThan(after);
  });
});

describe('AutomationService + store', () => {
  it('creates a schedule, materializes when due, and claims a run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-auto-'));
    dirs.push(dir);
    const dbPath = join(dir, 'automation.db');
    const service = new AutomationService({ dbPath });

    const spec = service.createSchedule({
      name: 'Due now',
      cron: '* * * * *',
      prompt: 'Say pong',
      workspaceRoot: dir,
      mode: 'ask',
      autonomyPreset: 'readonly',
    });
    expect(spec.nextRunAt).toBeTruthy();

    // Force due
    service.store.updateSpecScheduleCursor({
      specId: spec.specId,
      nextRunAt: '2000-01-01T00:00:00.000Z',
    });
    const { enqueued } = materializeDueRuns(service.store);
    expect(enqueued.length).toBe(1);

    const claim = service.store.claimNextRun({
      claimToken: 'claim_test',
      leaseSeconds: 60,
    });
    expect(claim?.runId).toBe(enqueued[0]!.runId);
    expect(claim?.status).toBe('running');

    service.store.completeRun({
      runId: claim!.runId,
      claimToken: 'claim_test',
      status: 'done',
    });
    expect(service.store.getRun(claim!.runId)?.status).toBe('done');
    service.close();
  });

  it('pause/resume/delete round-trip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-auto-'));
    dirs.push(dir);
    const service = new AutomationService({
      dbPath: join(dir, 'a.db'),
    });
    const spec = service.createSchedule({
      name: 'X',
      cron: '0 9 * * *',
      prompt: 'hi',
      workspaceRoot: dir,
    });
    service.pause(spec.specId);
    expect(service.getSchedule(spec.specId)?.enabled).toBe(false);
    service.resume(spec.specId);
    expect(service.getSchedule(spec.specId)?.enabled).toBe(true);
    service.delete(spec.specId);
    expect(service.getSchedule(spec.specId)).toBeUndefined();
    service.close();
  });
});

describe('SqliteAutomationStore lease reclaim', () => {
  it('reclaims expired running leases', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-auto-'));
    dirs.push(dir);
    const store = new SqliteAutomationStore(join(dir, 'db.sqlite'));
    store.upsertSpec({
      specId: 'spec_1',
      externalId: 'spec_1',
      sourcePath: 'api:schedule:spec_1',
      triggerKind: 'schedule',
      parseStatus: 'valid',
      title: 't',
      prompt: 'p',
      workspaceRoot: dir,
      scheduleExpr: '0 9 * * *',
      nextRunAt: '2099-01-01T00:00:00.000Z',
    });
    store.enqueueRun({
      runId: 'run_1',
      specId: 'spec_1',
      specRevision: 1,
      triggerKind: 'manual',
      scheduledFor: '2020-01-01T00:00:00.000Z',
    });
    const first = store.claimNextRun({
      claimToken: 'old',
      leaseSeconds: 1,
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(first?.status).toBe('running');

    const reclaimed = store.claimNextRun({
      claimToken: 'new',
      leaseSeconds: 60,
      now: new Date('2026-01-01T00:05:00.000Z'),
    });
    expect(reclaimed?.runId).toBe('run_1');
    expect(reclaimed?.claimToken).toBe('new');
    store.close();
  });
});

describe('DeliveryBus', () => {
  it('enqueues deliveries and retries until maxAttempts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-auto-'));
    dirs.push(dir);
    const service = new AutomationService({ dbPath: join(dir, 'd.db') });
    const spec = service.createSchedule({
      name: 'Deliver me',
      cron: '0 9 * * *',
      prompt: 'hi',
      workspaceRoot: dir,
      metadata: {
        delivery: [{ adapter: 'webhook', target: 'http://127.0.0.1:9/hook' }],
      },
    });
    // Patch metadata onto existing (createSchedule already supports metadata)
    expect(spec.metadataJson).toContain('webhook');

    const run = service.trigger(spec.specId);
    const { DeliveryBus } = await import('../delivery/bus.js');
    let attempts = 0;
    const bus = new DeliveryBus({
      store: service.store,
      maxAttempts: 3,
      sender: {
        async send() {
          attempts += 1;
          return { ok: false, error: 'boom' };
        },
      },
    });
    bus.enqueueForRun({
      runId: run.runId,
      targets: [{ adapter: 'webhook', target: 'http://example.test/h' }],
    });
    await bus.flushPending();
    await bus.flushPending();
    await bus.flushPending();
    expect(attempts).toBeGreaterThanOrEqual(3);
    const rows = service.store.listDeliveries({ runId: run.runId });
    expect(rows.some((r) => r.status === 'failed')).toBe(true);
    service.close();
  });

  it('marks sent when sender succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-auto-'));
    dirs.push(dir);
    const service = new AutomationService({ dbPath: join(dir, 'd2.db') });
    const spec = service.createSchedule({
      name: 'Ok',
      cron: '0 9 * * *',
      prompt: 'hi',
      workspaceRoot: dir,
    });
    const run = service.trigger(spec.specId);
    const { DeliveryBus } = await import('../delivery/bus.js');
    const bus = new DeliveryBus({
      store: service.store,
      sender: {
        async send() {
          return { ok: true };
        },
      },
    });
    bus.enqueueForRun({
      runId: run.runId,
      targets: [{ adapter: 'slack', target: 'C123' }],
    });
    const result = await bus.flushPending();
    expect(result.sent).toBe(1);
    expect(service.store.listDeliveries({ runId: run.runId })[0]?.status).toBe(
      'sent',
    );
    service.close();
  });
});

describe('incident fingerprint', () => {
  it('is stable for identical parts', async () => {
    const { buildIncidentFingerprint, formatIncidentIssueTitle } = await import(
      '../incident/evidence.js'
    );
    const a = buildIncidentFingerprint(['github.workflow_run.completed', 'acme/api', 'CI', '99', 'failure']);
    const b = buildIncidentFingerprint(['github.workflow_run.completed', 'acme/api', 'CI', '99', 'failure']);
    expect(a).toBe(b);
    expect(formatIncidentIssueTitle({ fingerprint: a, repository: 'acme/api' })).toContain(
      `[mitii:${a}]`,
    );
  });
});

describe('cron markdown frontmatter', () => {
  it('parses dotted filter.* keys into filtersJson', async () => {
    const { parseCronMarkdown } = await import('../specs/reconciler.js');
    const parsed = parseCronMarkdown(
      `---
name: ci-failure-triage
trigger: event
event: github.workflow_run.completed
filter.conclusion: failure
mode: agent
---

Triage this failure.
`,
      '/tmp/ci-failure.event.md',
    );
    expect(parsed.filtersJson).toBe(JSON.stringify({ conclusion: 'failure' }));
    expect(parsed.eventType).toBe('github.workflow_run.completed');
    expect(parsed.triggerKind).toBe('event');
  });
});

describe('export/import specs', () => {
  it('round-trips schedules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-auto-'));
    dirs.push(dir);
    const a = new AutomationService({ dbPath: join(dir, 'a.db') });
    a.createSchedule({
      name: 'Export me',
      cron: '0 8 * * *',
      prompt: 'ping',
      workspaceRoot: dir,
    });
    const payload = a.exportSpecs();
    a.close();

    const b = new AutomationService({ dbPath: join(dir, 'b.db') });
    const result = b.importSpecs(payload);
    expect(result.upserted).toBe(1);
    expect(b.listSchedules()[0]?.title).toBe('Export me');
    b.close();
  });
});

describe('security', () => {
  it('redacts tokens from evidence text', async () => {
    const { redactSecrets } = await import('../security/redact.js');
    const { text, redacted } = redactSecrets(
      'token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 password=hunter2',
    );
    expect(redacted).toBe(true);
    expect(text).toContain('[REDACTED:gh_pat]');
    expect(text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('verifies GitHub webhook HMAC', async () => {
    const { createHmac } = await import('node:crypto');
    const { verifyGitHubWebhookSignature } = await import(
      '../security/githubWebhook.js'
    );
    const body = Buffer.from('{"ok":true}');
    const secret = 'whsec_test';
    const sig =
      'sha256=' +
      createHmac('sha256', secret).update(body).digest('hex');
    expect(
      verifyGitHubWebhookSignature({
        rawBody: body,
        signatureHeader: sig,
        secret,
      }),
    ).toBe(true);
    expect(
      verifyGitHubWebhookSignature({
        rawBody: body,
        signatureHeader: 'sha256=deadbeef',
        secret,
      }),
    ).toBe(false);
  });
});

describe('EventIngress', () => {
  it('matches event specs, dedupes by eventId, and respects filters', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-auto-'));
    dirs.push(dir);
    const service = new AutomationService({ dbPath: join(dir, 'e.db') });
    service.store.upsertSpec({
      specId: 'spec_ci',
      externalId: 'ci-fail',
      sourcePath: 'api:event:ci-fail',
      triggerKind: 'event',
      parseStatus: 'valid',
      title: 'CI fail',
      prompt: 'Triage the failure',
      workspaceRoot: dir,
      eventType: 'github.workflow_run.completed',
      filtersJson: JSON.stringify({ conclusion: 'failure' }),
      dedupeWindowSeconds: 3600,
      maxParallel: 1,
      mode: 'agent',
      autonomyPreset: 'apply',
    });

    const first = service.ingestEvent({
      eventId: 'evt_1',
      eventType: 'github.workflow_run.completed',
      source: 'github',
      subject: 'acme/api',
      dedupeKey: 'fp_1',
      attributes: { conclusion: 'failure' },
      payload: { conclusion: 'failure' },
    });
    expect(first.duplicate).toBe(false);
    expect(first.queuedRuns).toHaveLength(1);
    expect(first.event.processingStatus).toBe('queued');

    const dup = service.ingestEvent({
      eventId: 'evt_1',
      eventType: 'github.workflow_run.completed',
      source: 'github',
    });
    expect(dup.duplicate).toBe(true);

    const filtered = service.ingestEvent({
      eventId: 'evt_2',
      eventType: 'github.workflow_run.completed',
      source: 'github',
      dedupeKey: 'fp_2',
      attributes: { conclusion: 'success' },
      payload: { conclusion: 'success' },
    });
    expect(filtered.queuedRuns).toHaveLength(0);
    expect(filtered.suppressions.some((s) => s.reason === 'filter_mismatch')).toBe(
      true,
    );

    const windowed = service.ingestEvent({
      eventId: 'evt_3',
      eventType: 'github.workflow_run.completed',
      source: 'github',
      dedupeKey: 'fp_1',
      attributes: { conclusion: 'failure' },
      payload: { conclusion: 'failure' },
    });
    expect(windowed.queuedRuns).toHaveLength(0);
    expect(
      windowed.suppressions.some((s) => s.reason === 'dedupe_window'),
    ).toBe(true);

    service.close();
  });

  it('normalizes GitHub workflow_run webhooks', async () => {
    const { normalizeGitHubWebhook } = await import('../events/github.js');
    const envelope = normalizeGitHubWebhook({
      headers: {
        'x-github-event': 'workflow_run',
        'x-github-delivery': 'deliv-1',
      },
      body: {
        action: 'completed',
        repository: { full_name: 'acme/api' },
        workflow_run: {
          id: 99,
          name: 'CI',
          conclusion: 'failure',
          head_sha: 'abc123',
          updated_at: '2026-08-30T12:00:00.000Z',
        },
      },
    });
    expect(envelope?.eventType).toBe('github.workflow_run.completed');
    expect(envelope?.attributes?.conclusion).toBe('failure');
    expect(envelope?.eventId).toBe('gh_deliv-1');
  });
});
