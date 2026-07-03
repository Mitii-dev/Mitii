import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { HeadlessAgentHost } from '../../src/core/headless/HeadlessAgentHost';

describe('HeadlessAgentHost', () => {
  it('runs stub ask/plan/agent without native index', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mitii-headless-'));
    const host = new HeadlessAgentHost({
      cwd,
      runtime: 'stub',
      providerType: 'echo',
      approval: 'auto',
    });

    const answer = await host.ask('hello');
    expect(answer).toContain('Echo:');

    const plan = await host.plan('ship feature');
    expect(plan).toMatchObject({ goal: 'ship feature' });

    const events: string[] = [];
    for await (const event of host.agent('review code')) {
      events.push(event.type);
    }
    expect(events).toContain('end');
    host.dispose();
  });

  it('initializes real runtime on fixture workspace', async () => {
    const cwd = join(process.cwd(), 'benchmark/fixtures/node-express');
    const host = new HeadlessAgentHost({
      cwd,
      packageRoot: process.cwd(),
      runtime: 'real',
      providerType: 'echo',
      approval: 'auto',
      indexWorkspace: true,
    });

    try {
      await host.initialize();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NODE_MODULE_VERSION') || message.includes('better_sqlite3')) {
        host.dispose();
        return;
      }
      throw error;
    }

    expect(host.isRealRuntime).toBe(true);

    const answer = await host.ask('What port does the app use?');
    expect(answer.length).toBeGreaterThan(0);
    host.dispose();
  }, 120_000);
});
