export type MicroTaskId = 'commit_message' | 'changelog_entry' | 'release_notes_draft';

export interface MicroTaskInput {
  userMessage: string;
  workspace: string;
}

export interface MicroTaskResult {
  id: MicroTaskId;
  content: string;
  metadata?: Record<string, unknown>;
}

const MICRO_TASK_PATTERNS: Array<[MicroTaskId, RegExp]> = [
  ['commit_message', /\b(commit message|commit msg|write (?:a |the )?commit message)\b/i],
  ['commit_message', /\b(?:commit|message|subject|summary)\b[\s\S]{0,80}\b(?:staged|stage|cached|git diff)\b/i],
  ['commit_message', /\b(?:staged|stage|cached|git diff)\b[\s\S]{0,80}\b(?:commit|message|subject|summary)\b/i],
  ['release_notes_draft', /\b(release notes?|what'?s new)\b/i],
  ['changelog_entry', /\b(changelog|what changed since)\b/i],
];

/**
 * A message can mention "commit message" purely as its own subject ("write a commit message
 * for the users.js fix") while ALSO stating the underlying work isn't actually done yet
 * ("it's not actually fixed yet, so fix it first"). Matching only the micro-task phrase would
 * route straight into the narrow, tool-less micro-task executor and silently skip the real fix
 * the rest of the sentence demands. Disqualify the micro-task match whenever such a competing
 * signal is present so the message falls through to the full agent loop instead.
 */
const COMPETING_FULL_TASK_SIGNAL =
  /\bnot\s+(?:actually\s+|yet\s+)?(?:fixed|done|complete|implemented|working)\b|\bstill\s+(?:broken|failing|buggy)\b|\bfix\s+it\s+first\b|\bneeds?\s+(?:to\s+be\s+)?fix(?:ed)?\s+first\b/i;

export function detectMicroTask(userMessage: string): MicroTaskId | null {
  const text = userMessage.trim();
  if (!text) return null;
  if (COMPETING_FULL_TASK_SIGNAL.test(text)) return null;
  return MICRO_TASK_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}
