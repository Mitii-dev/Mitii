import type { ReactNode } from 'react';

/** Describes one numeric policy field shown under "Advanced". */
export interface TokenBudgetFieldDescriptor {
  key: string;
  group: string;
  label: string;
  description: string;
  docsHref?: string | undefined;
  kind: 'ratio' | 'int' | 'number';
  min: number;
  max?: number | undefined;
  step: number;
  defaultValue?: number | undefined;
  tier?: 'simple' | 'advanced' | undefined;
  hiddenFromDebug?: boolean | undefined;
}

/**
 * Optional per-field help rendered under an Advanced number field
 * (docs links, derived-token hints). Hosts own this content.
 */
export type RenderTokenBudgetFieldHelp = (
  field: TokenBudgetFieldDescriptor,
  value: number,
) => ReactNode;

/**
 * Where field descriptions appear: only as a tooltip (`tooltip`) or as a
 * paragraph under each field (`inline`).
 */
export type TokenBudgetHintMode = 'tooltip' | 'inline';
