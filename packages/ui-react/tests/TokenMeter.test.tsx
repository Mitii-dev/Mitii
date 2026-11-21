import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  TokenMeter,
  addTurnTokens,
  emptyTokenUsage,
  type TokenMeterUsage,
} from '../src/index.js';

afterEach(() => cleanup());

const baseUsage: TokenMeterUsage = {
  ...emptyTokenUsage(128_000),
  inputTokensTotal: 12_000,
  outputTokensTotal: 3_400,
  sessionTotal: 15_400,
  modelCalls: 3,
  toolCalls: 5,
  turnCount: 2,
  lastPromptTokens: 4_000,
  lastResponseTokens: 800,
  currentTurnTotal: 4_800,
};

describe('TokenMeter', () => {
  it('shows compact totals on the chip', () => {
    render(<TokenMeter usage={baseUsage} />);
    const chip = screen.getByRole('button', { name: 'Chat token usage' });
    expect(chip.textContent).toContain('15k');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the detail dialog and closes on Escape', () => {
    render(<TokenMeter usage={baseUsage} reportedLabel="Session" />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat token usage' }));
    const dialog = screen.getByRole('dialog', { name: 'Token usage details' });
    expect(dialog.textContent).toContain('Chat token summary');
    expect(dialog.textContent).toContain('Session');
    expect(dialog.textContent).toContain('Total tokens');
    expect(dialog.textContent).toContain(
      'Context attribution will appear once the run builds a prompt.',
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses the compact live layout by default and the full grid on request', () => {
    const live = { ...baseUsage, live: true };
    const { rerender } = render(<TokenMeter usage={live} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat token usage' }));
    expect(screen.getByText('Current run')).toBeTruthy();
    expect(screen.queryByText('Duration')).toBeNull();

    rerender(<TokenMeter usage={live} liveStatsLayout="full" />);
    expect(screen.getByText('Duration')).toBeTruthy();
  });

  it('renders the window budget tree from the context breakdown', () => {
    render(
      <TokenMeter
        usage={{
          ...baseUsage,
          contextBreakdown: {
            slices: [],
            totalTokens: 20_000,
            contextWindow: 128_000,
            fillRatio: 0.156,
            source: 'prompt_budget',
            tree: [
              {
                id: 'output',
                label: 'Output reserve',
                kind: 'output',
                usedTokens: 0,
                allocatedTokens: 16_000,
                active: true,
              },
              {
                id: 'repository',
                label: 'Repository',
                kind: 'section',
                usedTokens: 9_000,
                allocatedTokens: 40_000,
                omittedTokens: 100,
                active: true,
                children: [
                  {
                    id: 'repoMap',
                    label: 'Repo map',
                    kind: 'source',
                    usedTokens: 4_000,
                    active: true,
                  },
                ],
              },
            ],
            estimated: false,
          },
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Chat token usage' }));
    expect(screen.getByRole('meter', { name: 'Context window fill' })).toBeTruthy();
    expect(screen.getByText('Output reserve')).toBeTruthy();
    expect(screen.getByText('Repo map')).toBeTruthy();
    expect(screen.getByText('100 omitted')).toBeTruthy();
    expect(screen.getByText('Budget')).toBeTruthy();
  });

  it('shows cost and cache chips when rates and cache counters exist', () => {
    render(
      <TokenMeter
        usage={{ ...baseUsage, cacheHitTokens: 6_000, cacheMissTokens: 6_000 }}
        costRates={{ input: 3, output: 15 }}
      />,
    );
    expect(screen.getByRole('button', { name: /Estimated cost/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cache hit 50%' })).toBeTruthy();
  });

  it('shows the muted cache chip when cost is known but cache is not reported', () => {
    render(<TokenMeter usage={baseUsage} costRates={{ input: 3, output: 15 }} />);
    expect(screen.getByRole('button', { name: 'Cache not reported' })).toBeTruthy();
  });

  it('adds placement classes and a glyph only when provided', () => {
    const { container, rerender } = render(<TokenMeter usage={baseUsage} />);
    expect(container.querySelector('.token-popover--below')).toBeNull();
    expect(container.querySelector('.token-chip__glyph')).toBeNull();
    rerender(
      <TokenMeter usage={baseUsage} placement="below" glyph={<i data-testid="g" />} />,
    );
    expect(container.querySelector('.token-popover--below')).not.toBeNull();
    expect(screen.getByTestId('g')).toBeTruthy();
  });
});

describe('token usage helpers', () => {
  it('folds a model call into cumulative totals and clamps negatives', () => {
    const next = addTurnTokens(emptyTokenUsage(1000), 100, -5, { hit: 40, miss: 60 });
    expect(next.inputTokensTotal).toBe(100);
    expect(next.outputTokensTotal).toBe(0);
    expect(next.sessionTotal).toBe(100);
    expect(next.modelCalls).toBe(1);
    expect(next.cacheHitTokens).toBe(40);
    expect(next.cacheMissTokens).toBe(60);
    expect(next.live).toBe(true);
    expect(next.contextWindow).toBe(1000);
  });
});
