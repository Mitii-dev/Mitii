import type {
  SourceReferenceKind,
} from '@mitii/v8';

const REFERENCE_KINDS = new Set<SourceReferenceKind>([
  'call',
  'construct',
  'read',
  'type',
  'unknown',
  'write',
]);

const REFERENCE_KIND_ALIASES: Readonly<Record<string, SourceReferenceKind>> = {
  class: 'construct',
  construct: 'construct',
  method: 'call',
  send: 'call',
  implementation: 'type',
  interface: 'type',
  module: 'type',
};

export function isSymbolNameCapture(captureName: string): boolean {
  return (
    captureName === 'name' ||
    captureName.startsWith('name.definition.')
  );
}

export function isSymbolDefinitionCapture(captureName: string): boolean {
  return (
    captureName === 'definition' ||
    captureName.startsWith('definition.')
  );
}

export function isReferenceNameCapture(captureName: string): boolean {
  return (
    captureName.startsWith('name.reference.') ||
    captureName.startsWith('reference.')
  );
}

export function symbolKindFromCapture(
  captureName: string,
): string | undefined {
  if (captureName.startsWith('definition.')) {
    return captureName.slice('definition.'.length) || undefined;
  }

  if (captureName.startsWith('name.definition.')) {
    return captureName.slice('name.definition.'.length) || undefined;
  }

  return undefined;
}

export function referenceKindFromCapture(
  captureName: string,
): SourceReferenceKind {
  const parts = captureName.split('.');
  const referenceIndex = parts.indexOf('reference');
  const raw =
    referenceIndex >= 0
      ? (parts[referenceIndex + 1] ?? 'unknown')
      : (parts[1] ?? 'unknown');

  const aliased = REFERENCE_KIND_ALIASES[raw];
  if (aliased) {
    return aliased;
  }

  return REFERENCE_KINDS.has(raw as SourceReferenceKind)
    ? (raw as SourceReferenceKind)
    : 'unknown';
}
