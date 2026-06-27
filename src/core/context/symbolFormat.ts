import type { ExtractedSymbol } from '../indexing/SymbolExtractor';

export interface FormattedSymbol {
  name: string;
  kind: string;
  exported?: boolean;
  signature?: string | null;
}

const KIND_PRIORITY: Record<string, number> = {
  class: 5,
  interface: 4,
  struct: 4,
  function: 3,
  method: 2,
  type: 2,
  enum: 2,
  const: 1,
  symbol: 0,
};

export function formatSymbolsAsAst(
  relPath: string,
  symbols: FormattedSymbol[],
  note = 'Full file content omitted for length. Use read_file to inspect implementation details.'
): string {
  const sorted = [...symbols].sort(
    (a, b) => (KIND_PRIORITY[b.kind] ?? 0) - (KIND_PRIORITY[a.kind] ?? 0)
  );
  const lines = sorted.map((s) => {
    const exportMark = s.exported ? ' (exported)' : '';
    const sig = s.signature?.trim();
    return sig
      ? `  ${s.kind} ${s.name}${exportMark}: ${sig}`
      : `  ${s.kind} ${s.name}${exportMark}`;
  });
  return `${relPath}\n${lines.join('\n')}\n\n<!-- ${note} -->`;
}

export function extractedToFormatted(symbols: ExtractedSymbol[]): FormattedSymbol[] {
  return symbols.map((s) => ({
    name: s.name,
    kind: s.kind,
    exported: s.signature?.includes('export') ?? false,
    signature: s.signature,
  }));
}
