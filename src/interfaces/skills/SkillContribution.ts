import type { SkillManifest } from './SkillManifest';

export interface SkillContribution {
  id: string;
  owner: string;
  manifest: SkillManifest;
  rootPath: string;
}
