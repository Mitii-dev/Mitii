import type { TokenBudgetFieldDescriptor } from './protocol.js';
import { TOKEN_BUDGET_FIELD_SPECS_CORE } from './tokenBudgetFieldSpecsCore.js';
import { TOKEN_BUDGET_FIELD_SPECS_HOST } from './tokenBudgetFieldSpecsHost.js';
import { TOKEN_BUDGET_FIELD_SPECS_OPS } from './tokenBudgetFieldSpecsOps.js';

/**
 * Developer Token Budget field descriptors (sans defaultValue/tier).
 * Defaults come from DEFAULT_WINDOW_BUDGET_POLICY in tokenBudgetSettings.ts.
 */
export const TOKEN_BUDGET_FIELD_SPECS: readonly Omit<
  TokenBudgetFieldDescriptor,
  'defaultValue' | 'tier'
>[] = [
  ...TOKEN_BUDGET_FIELD_SPECS_CORE,
  ...TOKEN_BUDGET_FIELD_SPECS_OPS,
  ...TOKEN_BUDGET_FIELD_SPECS_HOST,
];
