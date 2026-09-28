/**
 * Merge a Keep a Changelog section into CHANGELOG.md (create or prepend).
 */

export function unwrapRecipeAnswer(answer: string): string {
  const trimmed = answer.trim();
  const fenced = trimmed.match(/^```(?:\w+)?\r?\n([\s\S]*?)\r?\n```$/);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed;
}

/** Insert a new version section after the H1 title, or create a fresh file. */
export function mergeChangelogSection(
  existing: string | null | undefined,
  section: string,
): string {
  const body = unwrapRecipeAnswer(section).trim();
  if (!body) return (existing ?? '').trimEnd() + (existing ? '\n' : '');

  const prior = (existing ?? '').replace(/^\uFEFF/, '');
  if (!prior.trim()) {
    return `# Changelog\n\n${body}\n`;
  }

  const h1 = /^(#[ \t][^\n]*\r?\n+)/.exec(prior);
  if (h1) {
    const rest = prior.slice(h1[0].length).replace(/^\r?\n+/, '');
    return `${h1[1]}\n${body}\n\n${rest}`.replace(/\n{3,}/g, '\n\n');
  }

  return `${body}\n\n${prior}`.replace(/\n{3,}/g, '\n\n');
}
