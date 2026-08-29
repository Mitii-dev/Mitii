import { describe, expect, it } from 'vitest';

import {
  isReferenceNameCapture,
  isSymbolDefinitionCapture,
  isSymbolNameCapture,
  referenceKindFromCapture,
  symbolKindFromCapture,
} from './treeSitterQueryCaptures.js';

describe('treeSitterQueryCaptures', () => {
  it('accepts both Mitii and aider definition capture names', () => {
    expect(isSymbolNameCapture('name')).toBe(true);
    expect(isSymbolNameCapture('name.definition.function')).toBe(true);
    expect(isSymbolNameCapture('name.reference.call')).toBe(false);

    expect(isSymbolDefinitionCapture('definition')).toBe(true);
    expect(isSymbolDefinitionCapture('definition.method')).toBe(true);
    expect(isSymbolDefinitionCapture('name.definition.function')).toBe(false);
  });

  it('maps aider reference captures onto Mitii reference kinds', () => {
    expect(isReferenceNameCapture('reference.call')).toBe(true);
    expect(isReferenceNameCapture('name.reference.call')).toBe(true);
    expect(isReferenceNameCapture('name.definition.function')).toBe(false);

    expect(referenceKindFromCapture('reference.call')).toBe('call');
    expect(referenceKindFromCapture('name.reference.call')).toBe('call');
    expect(referenceKindFromCapture('name.reference.class')).toBe('construct');
    expect(referenceKindFromCapture('name.reference.method')).toBe('call');
    expect(referenceKindFromCapture('reference.send')).toBe('call');
  });

  it('extracts capture-derived symbol kinds', () => {
    expect(symbolKindFromCapture('definition.function')).toBe('function');
    expect(symbolKindFromCapture('name.definition.method')).toBe('method');
    expect(symbolKindFromCapture('name')).toBeUndefined();
  });
});
