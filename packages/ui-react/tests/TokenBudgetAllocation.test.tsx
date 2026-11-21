import { cleanup, render, screen } from '@testing-library/react';
import { deriveLiveTokenBudgetPreview } from '@mitii/ui-core';
import { afterEach, describe, expect, it } from 'vitest';

import { TokenBudgetAllocation } from '../src/index.js';

afterEach(() => cleanup());

describe('TokenBudgetAllocation', () => {
  it('renders a bar segment and legend row per allocated slice', () => {
    const preview = deriveLiveTokenBudgetPreview({ contextWindowTokens: 128_000 });
    const { container } = render(<TokenBudgetAllocation preview={preview} />);

    expect(screen.getByLabelText('Context window split')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Module share of the context window' })).toBeTruthy();

    const legendRows = container.querySelectorAll(
      '.token-budget-allocation__legend li',
    );
    expect(legendRows.length).toBeGreaterThanOrEqual(6);
    for (const label of ['Repository', 'Conversation', 'Plan', 'Skills']) {
      expect(screen.getByText(label)).toBeTruthy();
    }

    const segments = container.querySelectorAll(
      '.token-budget-allocation__segment',
    );
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.length).toBeLessThanOrEqual(legendRows.length);
    for (const segment of segments) {
      expect((segment as HTMLElement).style.width).toMatch(/%$/);
    }
  });

  it('formats legend percentages as window shares', () => {
    const preview = deriveLiveTokenBudgetPreview({ contextWindowTokens: 100_000 });
    const { container } = render(<TokenBudgetAllocation preview={preview} />);
    const pcts = [
      ...container.querySelectorAll('.token-budget-allocation__pct'),
    ].map((node) => node.textContent ?? '');
    expect(pcts.length).toBeGreaterThan(0);
    expect(pcts.every((text) => /^\d+(\.\d)?%$/.test(text))).toBe(true);
  });
});
