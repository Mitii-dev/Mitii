/**
 * Decode a SCIP `index.scip` protobuf payload into Mitii occurrence rows.
 */

import type { ScipOccurrence } from './scipTypes.js';

const DEFINITION_ROLE = 1;

type ScipIndexMessage = {
  documents?: Array<{
    relativePath?: string;
    occurrences?: Array<{
      symbol?: string;
      symbolRoles?: number;
      range?: number[];
      typedRange?: {
        case?: string;
        value?: {
          startLine?: number;
          startColumn?: number;
          endLine?: number;
          endColumn?: number;
          line?: number;
          start?: number;
          end?: number;
        };
      };
    }>;
  }>;
};

/**
 * Decode SCIP Index protobuf bytes. Returns [] when optional deps are missing
 * or the payload is not a valid Index.
 */
export async function parseScipIndexBinary(
  bytes: Uint8Array,
): Promise<ScipOccurrence[]> {
  let fromBinary: (schema: unknown, data: Uint8Array) => ScipIndexMessage;
  let IndexSchema: unknown;
  try {
    const protobuf = await import('@bufbuild/protobuf');
    const scip = await import('@scip-code/scip');
    fromBinary = protobuf.fromBinary as typeof fromBinary;
    IndexSchema = scip.IndexSchema;
  } catch {
    return [];
  }

  let index: ScipIndexMessage;
  try {
    index = fromBinary(IndexSchema, bytes);
  } catch {
    return [];
  }

  const out: ScipOccurrence[] = [];
  for (const doc of index.documents ?? []) {
    const relativePath = (doc.relativePath ?? '').replace(/\\/g, '/');
    if (!relativePath) continue;
    for (const occ of doc.occurrences ?? []) {
      const symbol = occ.symbol ?? '';
      if (!symbol) continue;
      const symbolName = extractScipSymbolName(symbol);
      if (!symbolName) continue;
      const line = occurrenceLine(occ);
      const roles = occ.symbolRoles ?? 0;
      out.push({
        relativePath,
        line,
        symbolName,
        scipSymbol: symbol,
        referenceKind:
          (roles & DEFINITION_ROLE) === DEFINITION_ROLE
            ? 'definition'
            : 'reference',
      });
    }
  }
  return out;
}

export function extractScipSymbolName(scipSymbol: string): string {
  if (!scipSymbol) return '';
  const parts = scipSymbol.split(' ');
  const last = parts[parts.length - 1] ?? '';
  return last.replace(/[().].*$/, '') || last;
}

function occurrenceLine(occ: {
  range?: number[];
  typedRange?: {
    case?: string;
    value?: {
      startLine?: number;
      line?: number;
    };
  };
}): number {
  const typed = occ.typedRange;
  if (typed?.case === 'singleLineRange' && typed.value) {
    const line = typed.value.line ?? typed.value.startLine;
    if (typeof line === 'number') return line + 1;
  }
  if (typed?.case === 'multiLineRange' && typed.value) {
    const line = typed.value.startLine;
    if (typeof line === 'number') return line + 1;
  }
  const range = occ.range;
  if (Array.isArray(range) && typeof range[0] === 'number') {
    return range[0] + 1;
  }
  return 1;
}
