export function formatSkillPromptContent(block: {
  content: string;
  resources?: {
    references?: readonly string[];
    scripts?: readonly string[];
  };
}): string {
  const references = block.resources?.references ?? [];
  const scripts = block.resources?.scripts ?? [];
  if (references.length === 0 && scripts.length === 0) {
    return block.content;
  }
  const lines = ["Available skill resources (use only if normal tool policy allows):"];
  if (references.length > 0) {
    lines.push(`references: ${references.slice(0, 12).join(", ")}`);
  }
  if (scripts.length > 0) {
    lines.push(`scripts: ${scripts.slice(0, 12).join(", ")}`);
  }
  return `${block.content.trim()}\n\n${lines.join("\n")}`;
}
