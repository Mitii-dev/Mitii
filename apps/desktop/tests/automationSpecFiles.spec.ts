/**
 * Flow → markdown file round-trip via @mitii/automation serialize/parse.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseCronMarkdown } from '@mitii/automation';
import { afterEach, describe, expect, it } from 'vitest';

import { createEmptyFlow } from '../src/shared/automations/flow.js';
import { writeFlowSpecFile } from '../src/engine/automationSpecFiles.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('automationSpecFiles', () => {
  it('writes schedule cron.md that parseCronMarkdown accepts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-desktop-auto-'));
    dirs.push(dir);
    const flow = createEmptyFlow({ id: 'morning-health', title: 'Morning' });
    flow.delivery = [
      { id: 'd1', adapter: 'webhook', target: 'http://127.0.0.1:9/hook' },
    ];
    const { path } = writeFlowSpecFile(dir, flow);
    expect(path.endsWith('morning-health.cron.md')).toBe(true);
    const raw = readFileSync(path, 'utf8');
    const parsed = parseCronMarkdown(raw, path);
    expect(parsed.triggerKind).toBe('schedule');
    expect(parsed.title).toBe('Morning');
    expect(parsed.metadataJson).toContain('webhook');
  });

  it('writes event specs under cron/events/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-desktop-auto-'));
    dirs.push(dir);
    const flow = createEmptyFlow({ id: 'post-commit-cover' });
    flow.trigger = {
      kind: 'event',
      eventType: 'github.push',
      dedupeWindowSeconds: 600,
    };
    flow.agent.mode = 'agent';
    flow.agent.autonomyPreset = 'apply_and_pr';
    const { path } = writeFlowSpecFile(dir, flow);
    expect(path.includes(`${join('events', 'post-commit-cover.event.md')}`)).toBe(
      true,
    );
    const parsed = parseCronMarkdown(readFileSync(path, 'utf8'), path);
    expect(parsed.triggerKind).toBe('event');
    expect(parsed.eventType).toBe('github.push');
  });
});
