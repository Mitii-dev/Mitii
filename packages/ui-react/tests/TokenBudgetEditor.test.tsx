import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { deriveLiveTokenBudgetPreview } from '@mitii/ui-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TokenBudgetEditor,
  type TokenBudgetFieldDescriptor,
} from '../src/index.js';

afterEach(() => cleanup());

const preview = deriveLiveTokenBudgetPreview({ contextWindowTokens: 128_000 });

const fields: TokenBudgetFieldDescriptor[] = [
  {
    key: 'compactionWarnRatio',
    group: 'Compaction',
    label: 'Warn ratio',
    description: 'When to warn.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.01,
    tier: 'advanced',
  },
  {
    key: 'repositoryShare',
    group: 'Usable-input shares',
    label: 'Repository share',
    description: 'Simple slider key.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.01,
    tier: 'simple',
  },
  {
    key: 'maxModelCallsMin',
    group: 'Run caps',
    label: 'Model calls (min)',
    description: 'Hidden from Debug.',
    kind: 'int',
    min: 1,
    step: 1,
    hiddenFromDebug: true,
  },
];

function renderEditor(
  overrides: Partial<Parameters<typeof TokenBudgetEditor>[0]> = {},
) {
  const onPolicyChange = vi.fn();
  const utils = render(
    <TokenBudgetEditor
      fields={[]}
      policy={{}}
      preview={preview}
      customEnabled
      outputOverride={false}
      disabled={false}
      onPolicyChange={onPolicyChange}
      {...overrides}
    />,
  );
  return { onPolicyChange, ...utils };
}

describe('TokenBudgetEditor', () => {
  it('renders the allocation chart and Simple sliders', () => {
    renderEditor();
    expect(screen.getByLabelText('Context window split')).toBeTruthy();
    for (const id of [
      'filesPerMutation',
      'outputRatio',
      'repositoryShare',
      'conversationShare',
      'planShare',
      'skillsShare',
      'verificationChecks',
    ]) {
      expect(document.getElementById(`tokenBudget.${id}`)).not.toBeNull();
    }
  });

  it('commits a share change as a 0–1 ratio', () => {
    const { onPolicyChange } = renderEditor();
    const slider = document.getElementById(
      'tokenBudget.repositoryShare',
    ) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '40' } });
    expect(onPolicyChange).toHaveBeenCalledWith({ repositoryShare: 0.4 });
  });

  it('marks the output slider as overridden and disabled', () => {
    renderEditor({ outputOverride: true });
    expect(screen.getByText('Max output override')).toBeTruthy();
    const slider = document.getElementById(
      'tokenBudget.outputRatio',
    ) as HTMLInputElement;
    expect(slider.disabled).toBe(true);
  });

  it('hides Advanced when there are no descriptors', () => {
    const { container } = renderEditor();
    expect(container.querySelector('details.token-budget-advanced')!.hasAttribute('hidden')).toBe(true);
  });

  it('shows Advanced fields with host help and commits clamped values', () => {
    const { container, onPolicyChange } = renderEditor({
      fields,
      renderFieldHelp: (field) => <span data-testid="help">{field.key}</span>,
    });
    const details = container.querySelector(
      'details.token-budget-advanced',
    ) as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(screen.getByText('Compaction')).toBeTruthy();
    expect(screen.getByTestId('help').textContent).toBe('compactionWarnRatio');
    const input = document.getElementById(
      'tokenBudget.compactionWarnRatio',
    ) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);
    expect(onPolicyChange).toHaveBeenCalledWith({ compactionWarnRatio: 1 });
  });

  it('skips simple-tier and hiddenFromDebug descriptors in Advanced', () => {
    const { container } = renderEditor({ fields });
    const details = container.querySelector(
      'details.token-budget-advanced',
    ) as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(
      document.getElementById('tokenBudget.compactionWarnRatio'),
    ).not.toBeNull();
    expect(screen.queryByText('Usable-input shares')).toBeNull();
    expect(screen.queryByText('Run caps')).toBeNull();
    expect(screen.queryByText('Repository share')).toBeNull();
    // The Simple slider with the same key still renders exactly once.
    expect(
      document.querySelectorAll('[id="tokenBudget.repositoryShare"]'),
    ).toHaveLength(1);
  });

  it('hides Advanced when every descriptor is simple or hidden', () => {
    const { container } = renderEditor({ fields: fields.slice(1) });
    expect(
      container
        .querySelector('details.token-budget-advanced')!
        .hasAttribute('hidden'),
    ).toBe(true);
  });

  it('shows descriptions inline when requested', () => {
    renderEditor({ hintMode: 'inline' });
    expect(
      screen.getByText('Share of usable input spent on plan text.'),
    ).toBeTruthy();
  });
});
