import type { InstructionBodiesByKind } from "../internal/system-context";

/** Build id→content maps for context-epoch mid-update body inject (no memory). */
export function buildInstructionBodies(params: {
  skills?: readonly { id: string; content: string }[];
  rules?: readonly { id: string; content: string }[];
  environment?: readonly { id: string; content: string }[];
}): InstructionBodiesByKind | undefined {
  const skills = toBodyMap(params.skills);
  const rules = toBodyMap(params.rules);
  const environment = toBodyMap(params.environment);
  if (!skills && !rules && !environment) {
    return undefined;
  }
  return {
    ...(skills ? { skills } : {}),
    ...(rules ? { rules } : {}),
    ...(environment ? { environment } : {}),
  };
}

function toBodyMap(
  blocks: readonly { id: string; content: string }[] | undefined,
): Record<string, string> | undefined {
  if (!blocks || blocks.length === 0) {
    return undefined;
  }
  const map: Record<string, string> = {};
  for (const block of blocks) {
    const id = block.id.trim();
    const content = block.content.trim();
    if (!id || !content) {
      continue;
    }
    map[id] = content;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}
