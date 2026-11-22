import { describe, expect, it } from 'vitest';

import {
  chatFilesFromRunChanges,
  gitFilesFromReview,
  resolveReviewBarScope,
} from '../src/review/reviewBarModel';
import {
  composerNeedsReviewStrip,
  selectLatestRunChanges,
} from '../src/review/selectLatestRunChanges';
import { severityTone, statusLabel, statusTone } from '../src/review/reviewBarFormat';

describe('resolveReviewBarScope', () => {
  const chat = [{ path: 'a.ts', status: 'M' }, { path: 'b.ts', status: 'A' }];
  const git = [
    ...chat,
    { path: 'c.ts', status: 'M' },
    { path: 'd.ts', status: '?' },
  ];

  it('summarizes this-chat file changes and keeps Code Review on full git', () => {
    const scope = resolveReviewBarScope({
      chatFiles: chat,
      gitFiles: git,
      findingsCount: 0,
      showCodeReview: true,
    });
    expect(scope.summaryLabel).toBe('2 file changes');
    expect(scope.chatFileCount).toBe(2);
    expect(scope.gitFileCount).toBe(4);
    expect(scope.codeReviewButtonLabel).toBe('Code Review (4)');
    expect(scope.canExpandReview).toBe(true);
    expect(scope.canRunCodeReview).toBe(true);
    expect(scope.showFindingsUi).toBe(true);
    expect(scope.visible).toBe(true);
  });

  it('hides Code Review findings UI when the feature is off', () => {
    const scope = resolveReviewBarScope({
      chatFiles: chat,
      gitFiles: git,
      findingsCount: 3,
      showCodeReview: false,
    });
    expect(scope.showFindingsUi).toBe(false);
    expect(scope.canRunCodeReview).toBe(false);
    expect(scope.visible).toBe(true);
    expect(scope.summaryLabel).toBe('2 file changes');
  });

  it('keeps Code Review metadata for the separate top CTA, but hides the review block for git-only trees', () => {
    const scope = resolveReviewBarScope({
      chatFiles: [],
      gitFiles: git,
      findingsCount: 0,
      showCodeReview: true,
    });
    expect(scope.visible).toBe(false);
    expect(scope.canExpandReview).toBe(false);
    expect(scope.canRunCodeReview).toBe(true);
    expect(scope.codeReviewButtonLabel).toBe('Code Review (4)');
  });

  it('hides the bar when there are no chat edits and Code Review is off', () => {
    const scope = resolveReviewBarScope({
      chatFiles: [],
      gitFiles: git,
      findingsCount: 0,
      showCodeReview: false,
    });
    expect(scope.visible).toBe(false);
  });

  it('hides the bar for 0 file changes even while a run is in progress', () => {
    const scope = resolveReviewBarScope({
      chatFiles: [],
      gitFiles: [],
      findingsCount: 0,
      showCodeReview: false,
      running: true,
    });
    expect(scope.visible).toBe(false);
  });

  it('disables Code Review while a run is in progress', () => {
    const scope = resolveReviewBarScope({
      chatFiles: chat,
      gitFiles: git,
      findingsCount: 0,
      showCodeReview: true,
      running: true,
    });
    expect(scope.canRunCodeReview).toBe(false);
    expect(scope.visible).toBe(true);
  });
});

describe('file mappers', () => {
  it('maps chat and git DTOs', () => {
    expect(chatFilesFromRunChanges([{ path: 'x.ts', status: 'M' }])).toEqual([
      { path: 'x.ts', status: 'M' },
    ]);
    expect(gitFilesFromReview([{ path: 'y.ts', status: 'A' }])).toEqual([
      { path: 'y.ts', status: 'A' },
    ]);
    expect(chatFilesFromRunChanges(null)).toEqual([]);
    expect(gitFilesFromReview(undefined)).toEqual([]);
  });
});

describe('selectLatestRunChanges', () => {
  it('returns the newest turn with file changes', () => {
    const latest = selectLatestRunChanges([
      { fileChanges: { runId: 'r1', files: [{ path: 'old.ts', status: 'M', additions: 1, deletions: 0 }], totalAdditions: 1, totalDeletions: 0 } },
      {},
      { fileChanges: { runId: 'r2', files: [{ path: 'new.ts', status: 'A', additions: 2, deletions: 0 }], totalAdditions: 2, totalDeletions: 0 } },
    ]);
    expect(latest?.runId).toBe('r2');
  });

  it('returns null when no turns have edits', () => {
    expect(selectLatestRunChanges([{}, { fileChanges: { runId: 'r', files: [], totalAdditions: 0, totalDeletions: 0 } }])).toBeNull();
  });
});

describe('composerNeedsReviewStrip', () => {
  it('reserves space for chat edits or findings, not git-only Code Review', () => {
    expect(
      composerNeedsReviewStrip({
        chatFileCount: 1,
        gitFileCount: 0,
        findingsCount: 0,
        codeReviewEnabled: false,
      }),
    ).toBe(true);
    expect(
      composerNeedsReviewStrip({
        chatFileCount: 0,
        gitFileCount: 5,
        findingsCount: 0,
        codeReviewEnabled: false,
      }),
    ).toBe(false);
    expect(
      composerNeedsReviewStrip({
        chatFileCount: 0,
        gitFileCount: 5,
        findingsCount: 0,
        codeReviewEnabled: true,
      }),
    ).toBe(false);
    expect(
      composerNeedsReviewStrip({
        chatFileCount: 0,
        gitFileCount: 5,
        findingsCount: 2,
        codeReviewEnabled: true,
      }),
    ).toBe(true);
  });
});

describe('reviewBarFormat', () => {
  it('maps status and severity tones', () => {
    expect(statusLabel('M')).toBe('Edited');
    expect(statusLabel('A')).toBe('Added');
    expect(statusTone('D')).toBe('deleted');
    expect(severityTone('critical')).toBe('high');
    expect(severityTone('medium')).toBe('medium');
    expect(severityTone('info')).toBe('low');
  });
});
