import { describe, expect, it, vi } from 'vitest';

import { noopSandboxLogger, type SandboxLoggerPort } from './SandboxLoggerPort.js';

describe('SandboxLoggerPort', () => {
  it('noop logger does not throw', () => {
    expect(() =>
      noopSandboxLogger.event({
        module: 'sandbox',
        stage: 'detect',
        level: 'debug',
      }),
    ).not.toThrow();
  });

  it('accepts stable reason codes without secrets', () => {
    const events: unknown[] = [];
    const logger: SandboxLoggerPort = {
      event(e) {
        events.push(e);
      },
    };
    logger.event({
      module: 'sandbox',
      stage: 'process.fail_closed',
      level: 'warn',
      reasonCodes: ['sandbox_unavailable'],
      details: { backendId: 'unavailable' },
    });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toMatch(/API_KEY|password|secret=/i);
  });

  it('can be spied for hosts', () => {
    const event = vi.fn();
    const logger: SandboxLoggerPort = { event };
    logger.event({ module: 'sandbox', stage: 'session.create', level: 'info' });
    expect(event).toHaveBeenCalledOnce();
  });
});
