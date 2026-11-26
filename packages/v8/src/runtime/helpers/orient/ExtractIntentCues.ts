import {
  intentCuesSchema,
  type IntentCues,
} from "../../contracts/orient/IntentCues";
import { hasExplicitEditLimit } from "../../../modules/decision-policy/helpers/ExtractExplicitMutationFence";

const PASTED_ERROR =
  /\b(?:Error|Exception|TypeError|ReferenceError|ENOENT|EACCES|panic|Traceback|at\s+\S+\s+\(.*:\d+:\d+\))/;

const CREATE_ASK =
  /\b(?:create|add|scaffold|generate|new)\b/i;

const DEBUG_ASK =
  /\b(?:fix|bug|debug|diagnos|crash|stack\s*trace|failing|broken)\b/i;

const READ_ONLY =
  /\b(?:read[-\s]?only|do\s+not\s+(?:edit|change|modify|write)|don't\s+(?:edit|change|modify|write)|no\s+code\s+changes?)\b/i;

/**
 * Deterministic intent cues for SituationPack.request.intentCues (S1-CUES).
 */
export function extractIntentCues(message: string): IntentCues {
  const constraintSnippets: string[] = [];
  if (hasExplicitEditLimit(message)) {
    const snippet = message.match(
      /[^.!?\n]*(?:only\s+(?:modify|change|edit|under|inside|within)|limit\s+changes|restrict\s+changes)[^.!?\n]*/i,
    );
    if (snippet?.[0]) {
      constraintSnippets.push(snippet[0].trim().slice(0, 180));
    }
  }

  return intentCuesSchema.parse({
    readOnlyAsk: READ_ONLY.test(message),
    explicitEditLimit: hasExplicitEditLimit(message),
    pastedErrorOrStack: PASTED_ERROR.test(message),
    createAsk: CREATE_ASK.test(message),
    debugAsk: DEBUG_ASK.test(message),
    constraintSnippets,
  });
}
