/**
 * Prompt helpers and diff previews.
 *
 * - Project rules: host-owned instruction files → `MitiiStartInput.projectRules`.
 * - Diff previews: proposed edit files under `.mitii/diff-preview`.
 */

export { loadProjectRules } from '../prompt/projectRules.js';
export type {
  LoadProjectRulesOptions,
  ProjectRuleBlock,
} from '../prompt/projectRules.js';

export { FileDiffPreviewStore } from '../preview/diffPreviewStore.js';
export type {
  DiffPreviewFile,
  PatchDiffPreviewFiles,
} from '../preview/diffPreviewStore.js';
