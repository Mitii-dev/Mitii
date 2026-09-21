/** Finding chip DTO shared by the review bar panels. */
export type ReviewFindingChip = {
  path: string;
  content: string;
  startLine?: number;
  endLine?: number;
  severity: string;
  category?: string;
  existingCode?: string;
  suggestionCode?: string;
  status?: 'open' | 'fixed';
};
