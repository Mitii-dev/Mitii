export interface ScipOccurrence {
  relativePath: string;
  line: number;
  symbolName: string;
  scipSymbol?: string;
  targetSymbol?: string;
  referenceKind?: string;
}

export interface ScipEnrichmentResult {
  written: number;
  skipped: boolean;
  reason?: string;
}
