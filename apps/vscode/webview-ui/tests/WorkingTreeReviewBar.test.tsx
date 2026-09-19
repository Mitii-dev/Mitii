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

  it('lists this-chat files under Review without embedding Code Review', () => {
    render(
      <WorkingTreeReviewBar
        review={review}
        runChanges={chatFiles}
        showCodeReview
        onRefresh={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenDiff={vi.fn()}
        onShowChanges={vi.fn()}
        onRunCodeReview={vi.fn()}
      />,
    );

    expect(screen.getByText('2 file changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('chat-a.ts')).toBeTruthy();
    expect(screen.getByText('chat-b.ts')).toBeTruthy();
    expect(screen.queryByText('extra.ts')).toBeNull();
    expect(screen.queryByRole('button', { name: /Code Review/ })).toBeNull();
  });

  it('renders nothing when there are 0 file changes', () => {
    const { container } = render(
      <WorkingTreeReviewBar
        review={{ summary: '', files: [] }}
        runChanges={null}
        running
        onRefresh={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenDiff={vi.fn()}
        onShowChanges={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByLabelText('Working tree review')).toBeNull();
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

  it('shows findings with severity and per-finding Fix (Fix all lives in Code Review row)', () => {
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
    expect(screen.queryByRole('button', { name: 'Fix all' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });
});
