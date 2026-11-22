import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { App } from '../src/App';

const bridge = vi.hoisted(() => ({
  post: vi.fn(),
  listener: undefined as ((message: unknown) => void) | undefined,
  subscriptions: 0,
}));
vi.mock('../src/bridge', () => ({
  postToHost: bridge.post,
  onHostMessage: (listener: (message: unknown) => void) => {
    bridge.listener = listener;
    bridge.subscriptions += 1;
    return () => {};
  },
}));

const emit = (message: unknown) => act(() => bridge.listener?.(message));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  bridge.subscriptions = 0;
  render(<App />);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  bridge.post.mockReset();
});

describe('host message routing through the composed App', () => {
  it('subscribes once and announces readiness to the host', () => {
    expect(bridge.subscriptions).toBe(1);
    expect(bridge.post).toHaveBeenCalledWith({ type: 'ready' });
    emit({ type: 'workspaceNotice', notice: {} });
    expect(bridge.subscriptions).toBe(1);
  });

  it('streams a run into the transcript and finalises the answer', () => {
    emit({ type: 'run.started', runId: 'r1', prompt: 'say hi', mode: 'ask' });
    expect(screen.getByText('say hi')).toBeTruthy();

    emit({ type: 'run.delta', runId: 'r1', text: 'Hel' });
    emit({ type: 'run.delta', runId: 'r1', text: 'lo' });
    expect(screen.getByText('Hello')).toBeTruthy();

    emit({
      type: 'run.result',
      runId: 'r1',
      status: 'completed',
      answer: 'Hello there',
    });
    expect(screen.getByText('Hello there')).toBeTruthy();
  });

  it('surfaces host errors in the banner and stops the running state', () => {
    emit({ type: 'run.started', runId: 'r2', prompt: 'boom', mode: 'ask' });
    emit({ type: 'error', message: 'engine exploded' });
    expect(screen.getByText(/engine exploded/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('routes navigation messages to the shell', () => {
    emit({ type: 'setTab', tab: 'history' });
    expect(screen.getByRole('button', { name: 'History' })).toBeTruthy();
    emit({ type: 'openSettings', tab: 'features' });
    expect(screen.getByText('Working-tree review')).toBeTruthy();
  });

  it('pins editor files from the host and honours explicit unpin', () => {
    emit({ type: 'setTab', tab: 'chat' });
    emit({ type: 'editorPin', path: 'src/a.ts', source: 'auto' });
    expect(screen.getByText(/a\.ts/)).toBeTruthy();
    emit({ type: 'editorUnpin', path: 'src/a.ts' });
    expect(screen.queryByText(/a\.ts/)).toBeNull();
  });
});
