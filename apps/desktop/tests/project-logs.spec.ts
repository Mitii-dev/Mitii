import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendDesktopLog,
  desktopLogFileName,
  errorMessage,
} from '../src/shared/project-logs.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('project-logs desktop date files', () => {
  it('names files by UTC calendar day', () => {
    expect(desktopLogFileName(new Date('2026-10-01T15:30:00.000Z'))).toBe(
      'desktop-2026-10-01.log',
    );
  });

  it('appends categorized lines into desktop-YYYY-MM-DD.log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-desktop-logs-'));
    dirs.push(dir);

    appendDesktopLog(dir, 'settings', 'save_failed boom', {
      level: 'error',
      extra: { workspaceRoot: '/tmp/demo' },
    });
    appendDesktopLog(dir, 'indexing', 'start', {
      mirrorRuns: true,
      extra: { force: true },
    });

    const desktop = readFileSync(join(dir, desktopLogFileName()), 'utf8');
    expect(desktop).toMatch(/ERROR \[settings\] save_failed boom/);
    expect(desktop).toMatch(/\/tmp\/demo/);
    expect(desktop).toMatch(/INFO \[indexing\] start/);

    const runs = readFileSync(join(dir, 'runs.log'), 'utf8');
    expect(runs).toMatch(/desktop_indexing start/);
  });

  it('errorMessage handles Error and primitives', () => {
    expect(errorMessage(new Error('x'))).toBe('x');
    expect(errorMessage('y')).toBe('y');
  });
});
