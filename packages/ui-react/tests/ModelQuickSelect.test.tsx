import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelQuickSelect } from '../src/index.js';

afterEach(() => cleanup());

async function openMenu() {
  fireEvent.click(document.querySelector('button[aria-haspopup="listbox"]')!);
  // The outside-click listener registers on the next tick.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

describe('ModelQuickSelect', () => {
  it('shows the active model and selects another from the menu', async () => {
    const onChange = vi.fn();
    const onOpen = vi.fn();
    render(
      <ModelQuickSelect
        model="gpt-a"
        models={['gpt-a', 'gpt-b']}
        onChange={onChange}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByRole('button', { name: /gpt-a/ })).toBeTruthy();
    await openMenu();
    expect(onOpen).toHaveBeenCalledTimes(1);
    const selected = screen.getByRole('option', { name: /gpt-a/ });
    expect(selected.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('option', { name: /gpt-b/ }));
    expect(onChange).toHaveBeenCalledWith('gpt-b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters long lists and reports empty matches', async () => {
    const models = Array.from({ length: 10 }, (_, i) => `model-${i}`);
    render(<ModelQuickSelect model="model-0" models={models} onChange={vi.fn()} />);
    await openMenu();
    const search = screen.getByPlaceholderText('Filter models…');
    fireEvent.change(search, { target: { value: 'model-7' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No models match that filter')).toBeTruthy();
  });

  it('can disable the filter box with an infinite threshold', async () => {
    const models = Array.from({ length: 12 }, (_, i) => `m-${i}`);
    render(
      <ModelQuickSelect
        model="m-0"
        models={models}
        filterThreshold={Number.POSITIVE_INFINITY}
        onChange={vi.fn()}
      />,
    );
    await openMenu();
    expect(screen.queryByPlaceholderText('Filter models…')).toBeNull();
  });

  it('supports a custom model row and inline id input', async () => {
    const custom = {
      active: false,
      onSelect: vi.fn(),
      onDraftChange: vi.fn(),
      onCommit: vi.fn(),
    };
    const { rerender } = render(
      <ModelQuickSelect
        model="gpt-a"
        models={['gpt-a']}
        onChange={vi.fn()}
        custom={custom}
      />,
    );
    await openMenu();
    fireEvent.click(screen.getByRole('option', { name: /Custom model/ }));
    expect(custom.onSelect).toHaveBeenCalledTimes(1);

    rerender(
      <ModelQuickSelect
        model="my-model"
        models={['gpt-a']}
        onChange={vi.fn()}
        custom={{ ...custom, active: true }}
      />,
    );
    const input = screen.getByTitle('Custom model id') as HTMLInputElement;
    expect(input.value).toBe('my-model');
    fireEvent.change(input, { target: { value: 'my-model-2' } });
    expect(custom.onDraftChange).toHaveBeenCalledWith('my-model-2');
    fireEvent.blur(input);
    expect(custom.onCommit).toHaveBeenCalledTimes(1);
  });

  it('runs the profile shortcut and closes on Escape', async () => {
    const onEditProfile = vi.fn();
    render(
      <ModelQuickSelect
        model="a"
        models={['a']}
        onChange={vi.fn()}
        onEditProfile={onEditProfile}
      />,
    );
    await openMenu();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile…' }));
    expect(onEditProfile).toHaveBeenCalledTimes(1);
  });

  it('shows loading text and respects disabled', () => {
    const { rerender } = render(
      <ModelQuickSelect model="" models={[]} loading onChange={vi.fn()} />,
    );
    expect(screen.getByText('Loading models…')).toBeTruthy();
    rerender(<ModelQuickSelect model="a" models={['a']} disabled onChange={vi.fn()} />);
    expect(
      (document.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
