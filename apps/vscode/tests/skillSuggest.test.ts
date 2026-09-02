import { describe, expect, it } from 'vitest';

import {
  detectSkillMentionQuery,
  filterSkillSuggestions,
  isActiveSkillSuggestRequest,
  skillCatalogSuggestSideEffects,
} from '../webview-ui/src/skillSuggest.ts';

const catalog = [
  {
    id: 'module-doc-generator',
    name: 'Module Doc Generator',
    description: 'Generate module README',
    enabled: true,
  },
  {
    id: 'cicd-agent',
    name: 'CI/CD Agent',
    description: 'Pipeline workflows',
    enabled: true,
  },
  {
    id: 'planning-and-task-breakdown',
    name: 'Planning',
    enabled: true,
  },
];

describe('filterSkillSuggestions', () => {
  it('returns all items when query is empty', () => {
    expect(filterSkillSuggestions(catalog, '')).toHaveLength(3);
  });

  it('filters by id and name case-insensitively', () => {
    expect(filterSkillSuggestions(catalog, 'cicd').map((item) => item.id)).toEqual([
      'cicd-agent',
    ]);
    expect(
      filterSkillSuggestions(catalog, 'module doc').map((item) => item.id),
    ).toEqual(['module-doc-generator']);
  });

  it('returns empty when nothing matches', () => {
    expect(filterSkillSuggestions(catalog, 'weather')).toEqual([]);
  });
});

describe('isActiveSkillSuggestRequest', () => {
  it('matches only the active request id', () => {
    expect(isActiveSkillSuggestRequest('42', '42')).toBe(true);
    expect(isActiveSkillSuggestRequest('42', '43')).toBe(false);
    expect(isActiveSkillSuggestRequest('', '42')).toBe(false);
  });
});

describe('skillCatalogSuggestSideEffects', () => {
  it('clears composer suggest loading for the active request', () => {
    expect(skillCatalogSuggestSideEffects('9', '9')).toEqual({
      clearSuggestLoading: true,
      suggestOpen: true,
      activeSuggest: 0,
    });
  });

  it('ignores stale or unrelated catalog responses', () => {
    expect(skillCatalogSuggestSideEffects('9', '10')).toBeUndefined();
  });
});

describe('detectSkillMentionQuery', () => {
  it('detects partial id at end of prompt', () => {
    expect(detectSkillMentionQuery('docs @skill:module')).toBe('module');
    expect(detectSkillMentionQuery('@skill:')).toBe('');
  });

  it('returns null when mention is not at end or missing', () => {
    expect(detectSkillMentionQuery('@skill:foo bar')).toBeNull();
    expect(detectSkillMentionQuery('@src/file.ts')).toBeNull();
  });
});
