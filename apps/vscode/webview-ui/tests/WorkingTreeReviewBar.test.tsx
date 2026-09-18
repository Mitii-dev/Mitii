import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkingTreeReviewBar } from '../src/review/WorkingTreeReviewBar';

afterEach(() => cleanup());

describe('WorkingTreeReviewBar', () => {
  const chatFiles = {
    runId: 'run-1',
    files: [
      { path: 'chat-a.ts', status: 'M' as const, additions: 1, deletions: 0 },
      { path: 'chat-b.ts', status: 'A' as const, additions: 2, deletions: 0 },
    ],
    totalAdditions: 3,
    totalDeletions: 0,
  };

  const review = {
    summary: '## main',
    files: [
      { path: 'chat-a.ts', status: 'M' },
      { path: 'chat-b.ts', status: 'A' },
      { path: 'extra.ts', status: 'M' },
    ],
  };

  it('lists this-chat files under Review and labels Code Review with git count', () => {
    const onRunCodeReview = vi.fn();
    render(
      <WorkingTreeReviewBar
        review={review}
        runChanges={chatFiles}
        showCodeReview
        onRefresh={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenDiff={vi.fn()}
        onShowChanges={vi.fn()}
        onRunCodeReview={onRunCodeReview}
      />,
    );

    expect(screen.getByText('2 file changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('chat-a.ts')).toBeTruthy();
    expect(screen.getByText('chat-b.ts')).toBeTruthy();
    expect(screen.queryByText('extra.ts')).toBeNull();

    const codeReview = screen.getByRole('button', {
      name: 'Code Review (3)',
    });
    fireEvent.click(codeReview);
    expect(onRunCodeReview).toHaveBeenCalledTimes(1);
  });

  it('hides Findings and Code Review when the feature is off', () => {
    render(
      <WorkingTreeReviewBar
        review={review}
        runChanges={chatFiles}
        findings={[
          {
            path: 'chat-a.ts',
            content: 'Bug',
            severity: 'high',
            status: 'open',
          },
        ]}
        showCodeReview={false}
        onRefresh={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenDiff={vi.fn()}
        onShowChanges={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Code Review/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.queryByRole('button', { name: /Findings/ })).toBeNull();
    expect(screen.queryByText('Bug')).toBeNull();
  });

  it('shows findings with severity and Fix when Code Review is enabled', () => {
    const onFixFinding = vi.fn();
    render(
      <WorkingTreeReviewBar
        review={review}
        runChanges={chatFiles}
        showCodeReview
        findings={[
          {
            path: 'extra.ts',
            content: 'Null deref',
            severity: 'critical',
            startLine: 10,
            status: 'open',
          },
        ]}
        onRefresh={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenDiff={vi.fn()}
        onShowChanges={vi.fn()}
        onRunCodeReview={vi.fn()}
        onFixFinding={onFixFinding}
        onFixAllFindings={vi.fn()}
      />,
    );

    expect(screen.getByText('critical')).toBeTruthy();
    expect(screen.getByText('Null deref')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));
    expect(onFixFinding).toHaveBeenCalledWith(0);
    expect(screen.getByRole('button', { name: 'Fix all' })).toBeTruthy();
  });
});
