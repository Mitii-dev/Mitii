import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CheckpointPanel } from '../src/index.js';

afterEach(() => cleanup());

const checkpoints = [
  {
    id: 'c1',
    label: 'After refactor',
    createdAt: '2026-01-02T03:04:05.000Z',
    changedPaths: ['a.ts', 'b.ts'],
  },
  { id: 'c2', label: 'Initial', createdAt: '2026-01-01T00:00:00.000Z' },
];

function handlers() {
  return { onRestore: vi.fn(), onDelete: vi.fn(), onClear: vi.fn() };
}

describe('CheckpointPanel', () => {
  it('renders the empty state with custom text and note', () => {
    render(
      <CheckpointPanel
        checkpoints={[]}
        emptyText="Nothing yet."
        note="Restore failed"
        {...handlers()}
      />,
    );
    expect(screen.getByText('Nothing yet.')).toBeTruthy();
    expect(screen.getByText('Restore failed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('lists checkpoints with file counts and routes actions', () => {
    const h = handlers();
    render(<CheckpointPanel checkpoints={checkpoints} {...h} />);
    expect(screen.getByText('After refactor')).toBeTruthy();
    expect(screen.getByText(/2 files/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0]!);
    expect(h.onRestore).toHaveBeenCalledWith('c1');
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete checkpoint Initial' }),
    );
    expect(h.onDelete).toHaveBeenCalledWith('c2');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(h.onClear).toHaveBeenCalledTimes(1);
  });

  it('shows Review only when a handler is provided', () => {
    const onReview = vi.fn();
    const { rerender } = render(
      <CheckpointPanel checkpoints={checkpoints} {...handlers()} />,
    );
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    rerender(
      <CheckpointPanel
        checkpoints={checkpoints}
        onReviewChanges={onReview}
        {...handlers()}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[1]!);
    expect(onReview).toHaveBeenCalledWith('c2');
  });

  it('disables actions while busy', () => {
    render(<CheckpointPanel busy checkpoints={checkpoints} {...handlers()} />);
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
