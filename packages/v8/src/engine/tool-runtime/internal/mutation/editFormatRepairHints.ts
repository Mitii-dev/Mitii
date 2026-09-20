/**
 * Edit-format repair ladder as prompt / error hints.
 * Does not replace Mitii `apply_patch` — only guides retries.
 * Inspiration acknowledgement (not copied upstream): see Mitii/NOTICE-REVIEW.md.
 */

export type EditFormatLadderStep =
  | 'exact_old_text'
  | 'more_context'
  | 'smaller_hunk'
  | 'fuzzy_match'
  | 'full_file_replace';

export interface EditFormatRepairHint {
  step: EditFormatLadderStep;
  message: string;
}

/**
 * Ordered fallback hints after an apply_patch failure.
 * Models should climb the ladder; hosts may also surface these in tool errors.
 */
export function buildEditFormatRepairHints(params: {
  code:
    | 'old_text_not_found'
    | 'old_text_ambiguous'
    | 'identical_old_and_new'
    | 'patch_hash_mismatch'
    | 'path_out_of_scope'
    | string;
  path?: string;
  fuzzyMatchEnabled?: boolean;
}): EditFormatRepairHint[] {
  const path = params.path ? `"${params.path}"` : 'the target file';
  const hints: EditFormatRepairHint[] = [];

  switch (params.code) {
    case 'identical_old_and_new':
      hints.push({
        step: 'exact_old_text',
        message: `oldText and newText are identical for ${path}. Copy a real before/after change; do not resend the same block.`,
      });
      break;
    case 'old_text_ambiguous':
      hints.push({
        step: 'more_context',
        message: `oldText matches multiple places in ${path}. Widen the SEARCH context (more surrounding lines) or set replaceAll=true only when every occurrence should change.`,
      });
      hints.push({
        step: 'smaller_hunk',
        message: 'Prefer one unique hunk per apply_patch call instead of a large multi-site block.',
      });
      break;
    case 'old_text_not_found':
      hints.push({
        step: 'exact_old_text',
        message: `oldText was not found in ${path}. Re-read the file and copy the exact current text into oldText (whitespace-sensitive).`,
      });
      hints.push({
        step: 'more_context',
        message: 'Include 3–8 surrounding lines so the hunk is unique and matches live content.',
      });
      hints.push({
        step: 'smaller_hunk',
        message: 'Shrink the hunk to the minimal unique region, then apply follow-up patches.',
      });
      if (params.fuzzyMatchEnabled) {
        hints.push({
          step: 'fuzzy_match',
          message:
            'Fuzzy match is enabled — retry once with the closest exact snippet; do not invent large rewrites.',
        });
      }
      hints.push({
        step: 'full_file_replace',
        message:
          'Last resort only: empty oldText replaces the whole file. Prefer exact hunks; use full replace only for small new files or when the user asked for a full rewrite.',
      });
      break;
    case 'patch_hash_mismatch':
      hints.push({
        step: 'exact_old_text',
        message: `File hash changed for ${path}. Re-read current content, then retry apply_patch with fresh oldText.`,
      });
      break;
    default:
      hints.push({
        step: 'exact_old_text',
        message: `Retry apply_patch on ${path} with exact oldText from currentContent. Climb: exact → more context → smaller hunk → (optional fuzzy) → full replace only as last resort.`,
      });
  }

  return hints;
}

/** Compact multiline string for tool error / system nudge. */
export function formatEditFormatRepairHints(
  hints: readonly EditFormatRepairHint[],
): string {
  if (hints.length === 0) return '';
  return [
    'Edit-format repair ladder (keep using apply_patch):',
    ...hints.map((hint, index) => `${index + 1}. [${hint.step}] ${hint.message}`),
  ].join('\n');
}

/** Short system guidance when write tools are granted. */
export const EDIT_FORMAT_LADDER_SYSTEM_HINT =
  'When apply_patch fails: (1) re-read and copy exact oldText, (2) add surrounding context if ambiguous, (3) use smaller hunks, (4) only then rely on fuzzyMatch if enabled, (5) full-file replace (empty oldText) is last resort. Never switch to inventing a different edit format in chat.';
