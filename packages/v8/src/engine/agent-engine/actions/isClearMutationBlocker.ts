/**
 * Detect text-only stops that honestly report why a workspace edit cannot
 * proceed. Recovery nudges invite "stop with a clear blocker"; without this
 * check those answers are treated as unfulfilled execute and the run fails.
 */
const TRANSITIONAL_OPENER =
  /^(?:okay[,.]?\s+|ok[,.]?\s+|sure[,.]?\s+|alright[,.]?\s+)?(?:let me|i(?:'ll| will)|i(?:'m| am) going to|i need to|i should)\b/i;

const EXPLICIT_BLOCKER_HEADER =
  /^(?:blocker|blocked|cannot proceed|can't proceed|unable to proceed)\s*[:\-—]/i;

const CANNOT_EDIT =
  /\b(?:cannot|can't|unable to|won't)\s+(?:fix|patch|edit|change|mutate|apply)\b/i;

const MISSING_EXTERNAL_PREREQ =
  /\b(?:requires?|needs?|missing|must\s+(?:provide|supply|set|configure)|blocked\s+on)\b[\s\S]{0,80}\b(?:api\s*key|apikey|access\s*token|auth(?:entication|orization)?|credentials?|config(?:uration)?\s+params?|environment\s+variables?|\.env|backend|external\s+(?:service|api|dependency)|network\s+access|user\s+input)\b/i;

const NO_CODE_FIX =
  /\b(?:no\s+(?:code|workspace|source)\s+(?:change|edit|fix|patch)\s+(?:can|will|is\s+able\s+to)\b|\b(?:this|that)\s+is\s+not\s+(?:a\s+)?(?:code|workspace)\s+(?:bug|fix|issue)\b|\bcannot\s+be\s+fixed\s+(?:in|by)\s+(?:code|editing|a\s+patch)\b)/i;

export function isClearMutationBlocker(content: string): boolean {
  const text = content.trim();
  if (text.length < 40) {
    return false;
  }
  if (TRANSITIONAL_OPENER.test(text)) {
    return false;
  }

  if (EXPLICIT_BLOCKER_HEADER.test(text)) {
    return true;
  }

  const signals = [CANNOT_EDIT, MISSING_EXTERNAL_PREREQ, NO_CODE_FIX].filter(
    (pattern) => pattern.test(text),
  ).length;
  return signals >= 1 && text.length >= 80;
}
