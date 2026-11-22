import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryPanel } from '../src/index.js';

afterEach(() => cleanup());

const memories = [
  { id: 'm1', text: 'Prefer pnpm', createdAt: '2026-01-02T03:04:05.000Z' },
  { id: 'm2', text: 'Use vitest', createdAt: '2026-01-03T03:04:05.000Z' },
];

describe('MemoryPanel', () => {
  it('shows the empty state and hides Clear all', () => {
    render(
      <MemoryPanel
        memories={[]}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('No observations yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('lists memories and routes delete / clear', () => {
    const onDelete = vi.fn();
    const onClear = vi.fn();
    render(
      <MemoryPanel
        memories={memories}
        onAdd={vi.fn()}
        onDelete={onDelete}
        onClear={onClear}
      />,
    );
    expect(screen.getByText('Prefer pnpm')).toBeTruthy();
    expect(screen.getByText('Use vitest')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete memory' })[1]!);
    expect(onDelete).toHaveBeenCalledWith('m2');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('adds trimmed text and clears the draft', async () => {
    const onAdd = vi.fn();
    render(
      <MemoryPanel
        memories={[]}
        onAdd={onAdd}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(
      'Add a workspace preference or observation…',
    ) as HTMLTextAreaElement;
    const add = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '  remember this  ' } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledWith('remember this');
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('saves with Ctrl+Enter', async () => {
    const onAdd = vi.fn();
    render(
      <MemoryPanel
        memories={[]}
        onAdd={onAdd}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(
      'Add a workspace preference or observation…',
    );
    fireEvent.change(input, { target: { value: 'quick note' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(onAdd).toHaveBeenCalledWith('quick note');
    await waitFor(() =>
      expect((input as HTMLTextAreaElement).value).toBe(''),
    );
  });

  it('disables controls and ignores submit while busy', () => {
    const onAdd = vi.fn();
    render(
      <MemoryPanel
        busy
        memories={memories}
        onAdd={onAdd}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(
      'Add a workspace preference or observation…',
    ) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Clear all' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('applies a custom root class', () => {
    const { container } = render(
      <MemoryPanel
        className="context-side-panel"
        memories={[]}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(container.querySelector('section.context-side-panel')).not.toBeNull();
  });
});
