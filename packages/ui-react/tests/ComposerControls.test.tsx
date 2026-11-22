import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ComposerControls,
  DEFAULT_MODE_OPTIONS,
  composerModeColor,
  type ComposerControlsProps,
} from '../src/index.js';

afterEach(() => cleanup());

function renderControls(overrides: Partial<ComposerControlsProps> = {}) {
  const props: ComposerControlsProps = {
    mode: 'agent',
    approvalMode: 'guided',
    thoroughness: 'medium',
    onModeChange: vi.fn(),
    onApprovalModeChange: vi.fn(),
    onThoroughnessChange: vi.fn(),
    ...overrides,
  };
  render(<ComposerControls {...props} />);
  return props;
}

async function openDropdown(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  // The outside-click listener registers on the next tick.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

describe('ComposerControls', () => {
  it('shows the active labels and keeps the stable class contract', () => {
    renderControls();
    expect(document.querySelector('.composer-controls')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mode' }).textContent).toContain('Agent');
    expect(screen.getByRole('button', { name: 'Approval' }).textContent).toContain(
      'Approve for me',
    );
    expect(screen.getByRole('button', { name: 'Thoroughness' }).textContent).toContain(
      'Medium',
    );
    expect(document.querySelector('.composer-dropdown--dbAccess')).toBeNull();
  });

  it('opens, selects an option, and closes', async () => {
    const props = renderControls();
    expect(screen.queryByRole('listbox')).toBeNull();
    await openDropdown('Mode');
    expect(screen.getByRole('listbox', { name: 'Mode' })).toBeTruthy();
    expect(
      screen.getByRole('option', { name: /Agent/ }).getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('option', { name: /Plan/ }));
    expect(props.onModeChange).toHaveBeenCalledWith('plan');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape and on outside pointer down', async () => {
    renderControls();
    await openDropdown('Approval');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    await openDropdown('Approval');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('routes approval and thoroughness changes', async () => {
    const props = renderControls();
    await openDropdown('Approval');
    fireEvent.click(screen.getByRole('option', { name: /Full access/ }));
    expect(props.onApprovalModeChange).toHaveBeenCalledWith('pilot');
    await openDropdown('Thoroughness');
    fireEvent.click(screen.getByRole('option', { name: /High/ }));
    expect(props.onThoroughnessChange).toHaveBeenCalledWith('high');
  });

  it('shows Custom and marks no level selected with intensityCustom', async () => {
    const props = renderControls({ intensityCustom: true });
    expect(screen.getByRole('button', { name: 'Thoroughness' }).textContent).toContain(
      'Custom',
    );
    await openDropdown('Thoroughness');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    for (const option of options) {
      expect(option.getAttribute('aria-selected')).toBe('false');
    }
    fireEvent.click(screen.getByRole('option', { name: /Medium/ }));
    expect(props.onThoroughnessChange).toHaveBeenCalledWith('medium');
  });

  it('swaps approval for DB access only in database mode with a handler', async () => {
    const onDbAccessChange = vi.fn();
    const props = renderControls({ mode: 'agent', onDbAccessChange });
    expect(screen.queryByRole('button', { name: 'DB access' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Approval' })).toBeTruthy();
    cleanup();

    renderControls({ mode: 'database', onDbAccessChange, dbAccess: 'readwrite' });
    expect(screen.queryByRole('button', { name: 'Approval' })).toBeNull();
    expect(screen.getByRole('button', { name: 'DB access' }).textContent).toContain(
      'Read & write',
    );
    await openDropdown('DB access');
    fireEvent.click(screen.getByRole('option', { name: /Read-only/ }));
    expect(onDbAccessChange).toHaveBeenCalledWith('readonly');
    expect(props.onApprovalModeChange).not.toHaveBeenCalled();
    cleanup();

    renderControls({ mode: 'database' });
    expect(screen.getByRole('button', { name: 'Approval' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'DB access' })).toBeNull();
  });

  it('disables every trigger when disabled', () => {
    renderControls({ disabled: true });
    for (const name of ['Mode', 'Approval', 'Thoroughness']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
  });

  it('renders host icons and a reserved check slot', async () => {
    renderControls({
      icons: { agent: <i data-testid="agent-icon" />, plan: <i data-testid="plan-icon" /> },
      checkIcon: <b data-testid="check" />,
    });
    expect(screen.getByTestId('agent-icon')).toBeTruthy();
    await openDropdown('Mode');
    expect(screen.getByTestId('plan-icon')).toBeTruthy();
    expect(screen.getAllByTestId('check')).toHaveLength(1);
    expect(document.querySelectorAll('.composer-dropdown__option-check')).toHaveLength(
      DEFAULT_MODE_OPTIONS.length,
    );
  });

  it('defaults to a plain check on the selected row only', async () => {
    renderControls();
    await openDropdown('Mode');
    const checks = document.querySelectorAll('.composer-dropdown__option-check');
    expect(checks).toHaveLength(1);
    expect(checks[0]!.textContent).toBe('✓');
    expect(document.querySelector('.composer-dropdown__option-icon')).toBeNull();
  });

  it('accepts option catalog overrides', async () => {
    renderControls({
      modeOptions: [
        { id: 'ask', label: 'Chat', description: 'Just talk', color: '#111' },
        { id: 'agent', label: 'Do', description: 'Do things', color: '#222' },
      ],
    });
    expect(screen.getByRole('button', { name: 'Mode' }).textContent).toContain('Do');
    await openDropdown('Mode');
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('maps mode ids to accent colours with an Ask fallback', () => {
    expect(composerModeColor('agent')).toBe('#ef4444');
    expect(composerModeColor('review')).toBe(composerModeColor('ask'));
  });
});
