const QUERY_STOP_WORDS = new Set([
  "The",
  "This",
  "That",
  "What",
  "When",
  "Where",
  "How",
  "Why",
  "Who",
  "Which",
  "Did",
  "Does",
  "Do",
  "Is",
  "Are",
  "Was",
  "Were",
  "Has",
  "Have",
  "Had",
  "Can",
  "Could",
  "Would",
  "Should",
  "Will",
  "May",
  "Might",
  "If",
  "And",
  "But",
  "Or",
  "Not",
  "For",
  "From",
  "With",
  "About",
  "After",
  "Before",
  "Between",
  "I",
  "In",
  "A",
  "An",
  "Keep",
  "Add",
  "Show",
]);

const PATH_PATTERN = /(?:[\w.-]+\/)+[\w.-]+\.\w+/g;

/**
 * Cheap entity extraction for retrieve (no model call).
 * Pulls quoted phrases, file paths, and capitalized identifiers.
 */
export function extractEntitiesFromQuery(query: string): string[] {
  const entities: string[] = [];

  const quoted = query.match(/"([^"]+)"/g);
  if (quoted) {
    for (const match of quoted) {
      const value = match.replace(/"/g, "").trim();
      if (value.length > 0) {
        entities.push(value);
      }
    }
  }

  const paths = query.match(PATH_PATTERN);
  if (paths) {
    entities.push(...paths);
  }

  const capitalized = query.match(/\b[A-Z][a-zA-Z0-9_.-]+\b/g);
  if (capitalized) {
    for (const token of capitalized) {
      if (!QUERY_STOP_WORDS.has(token)) {
        entities.push(token);
      }
    }
  }

  return [...new Set(entities)];
}
