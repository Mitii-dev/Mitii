export const CODE_IDENTIFIER_MINIMUM_PART_CHARACTERS = 2;
export const CODE_IDENTIFIER_MINIMUM_TERM_CHARACTERS = 3;

const IDENTIFIER_PATTERN = /[A-Za-z_$][A-Za-z0-9_$]*/g;

export function splitCodeIdentifier(
  term: string,
  minimumPartCharacters: number = CODE_IDENTIFIER_MINIMUM_PART_CHARACTERS,
): string[] {
  return term
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((value) => value.toLowerCase())
    .filter((value) => value.length >= minimumPartCharacters);
}

export function expandCodeIdentifierTerms(
  term: string,
): string[] {
  const lower = term.toLowerCase();
  const parts = splitCodeIdentifier(term);
  const compact = parts.join("");
  const expanded = [
    ...(lower.length >= CODE_IDENTIFIER_MINIMUM_TERM_CHARACTERS
      ? [lower]
      : []),
    ...(parts.length > 1 ? parts : []),
  ];

  if (
    compact.length >= CODE_IDENTIFIER_MINIMUM_TERM_CHARACTERS &&
    compact !== lower
  ) {
    expanded.push(compact);
  }

  return [...new Set(expanded)];
}

export function expandFtsText(value: string): string {
  const identifiers = value.match(IDENTIFIER_PATTERN) ?? [];
  const expanded = identifiers.flatMap((identifier) =>
    expandCodeIdentifierTerms(identifier),
  );

  return [value, ...expanded].join(" ");
}
