/** Lifecycle of a finding in the composer review strip. */
export type ReviewFindingStatus = 'open' | 'fixed';

/** Finding row shown by the composer review strip in every host. */
export interface ReviewFindingChip {
  path: string;
  content: string;
  startLine?: number;
  endLine?: number;
  /** Host-normalised severity label (`critical`, `high`, …); not constrained here. */
  severity: string;
  category?: string;
  existingCode?: string;
  suggestionCode?: string;
  status?: ReviewFindingStatus;
}

/** Counts derived from a finding list. */
export interface ReviewFindingSummary {
  open: readonly ReviewFindingChip[];
  fixed: readonly ReviewFindingChip[];
  total: number;
  /** True when findings exist and every one of them is fixed. */
  complete: boolean;
}
