import {
  DIAGNOSIS_TASK_INTENTS,
  MUTATION_TASK_INTENTS,
} from "../constants";


const MUTATION_INTENT_SET = new Set<string>(MUTATION_TASK_INTENTS);

const DIAGNOSIS_INTENT_SET = new Set<string>(DIAGNOSIS_TASK_INTENTS);


export function isMutationIntent(intent: string): boolean {
  return MUTATION_INTENT_SET.has(intent);
}


export function isDiagnosisIntent(intent: string): boolean {
  return DIAGNOSIS_INTENT_SET.has(intent);
}
