import { describe, expect, it } from 'vitest';

import {
  mergeChangelogSection,
  unwrapRecipeAnswer,
} from '../src/renderer/git/changelogMerge.js';

describe('changelogMerge', () => {
  it('unwraps fenced answers', () => {
    expect(unwrapRecipeAnswer('```md\n## [1.0.0] - 2026-01-01\n```')).toBe(
      '## [1.0.0] - 2026-01-01',
    );
  });

  it('creates a fresh CHANGELOG when missing', () => {
    const next = mergeChangelogSection(
      null,
      '## [1.0.0] - 2026-09-27\n### Added\n- Feature',
    );
    expect(next).toContain('# Changelog');
    expect(next).toContain('## [1.0.0]');
    expect(next).toContain('- Feature');
  });

  it('prepends a section after the H1', () => {
    const existing = `# Changelog\n\n## [0.9.0] - 2026-01-01\n### Fixed\n- Bug\n`;
    const next = mergeChangelogSection(
      existing,
      '## [1.0.0] - 2026-09-27\n### Added\n- Feature',
    );
    expect(next.indexOf('## [1.0.0]')).toBeLessThan(next.indexOf('## [0.9.0]'));
    expect(next.startsWith('# Changelog')).toBe(true);
  });
});
