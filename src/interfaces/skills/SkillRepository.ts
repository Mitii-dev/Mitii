import type { SkillManifest } from './SkillManifest';

export interface SkillDocument {
  manifest: SkillManifest;
  content: string;
  revision: string;
  source: 'builtin' | 'internal' | 'repository' | 'installed';
}

export interface SkillRepositoryQuery {
  text?: string;
  enabled?: boolean;
  modes?: string[];
  sort?: 'name' | 'priority' | 'updated';
  limit?: number;
  offset?: number;
}

export interface SkillRepositoryPage {
  items: SkillManifest[];
  total: number;
  limit: number;
  offset: number;
}

export interface SkillRepository {
  search(query: SkillRepositoryQuery): SkillRepositoryPage;
  get(id: string): SkillDocument | undefined;
  save(document: Omit<SkillDocument, 'revision'>, expectedRevision?: string): SkillDocument;
  delete(id: string, expectedRevision?: string): void;
}
