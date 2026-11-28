import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PendingPlanBanner } from '../src/index.js';

afterEach(() => cleanup());

describe('PendingPlanBanner', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(
      <PendingPlanBanner visible={false} onExecuteInAgent={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows the default description and runs the Build action', () => {
    const onExecute = vi.fn();
    render(<PendingPlanBanner visible onExecuteInAgent={onExecute} />);
    expect(screen.getByRole('status').textContent).toContain('Plan ready.');
    expect(screen.getByRole('status').textContent).toContain(
      'Build to implement it.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Build' }));
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('supports a custom description and dismiss', () => {
    const onDismiss = vi.fn();
    render(
      <PendingPlanBanner
        visible
        description="Build to implement it."
        onExecuteInAgent={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain(
      'Build to implement it.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('disables both actions while busy', () => {
    render(
      <PendingPlanBanner
        visible
        busy
        onExecuteInAgent={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole('button', { name: 'Build' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
