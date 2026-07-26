import type { PromptInstructions } from "../../../../modules/prompt-construction";

type InstructionBlock = {
  id: string;
  title?: string;
  content: string;
  priority?: number;
};

/**
 * Merge host-supplied instructions with Skills/Memory selections.
 * Host projectRules always win as-is. Selected skills/memory are appended
 * after host-supplied entries, deduped by id (host wins on collision).
 */
export function mergePromptInstructions(params: {
  host?: PromptInstructions;
  skills?: readonly InstructionBlock[];
  memory?: readonly InstructionBlock[];
}): PromptInstructions | undefined {
  const projectRules = params.host?.projectRules
    ? [...params.host.projectRules]
    : undefined;

  const skills = mergeBlocks(params.host?.skills, params.skills);
  const memory = mergeBlocks(params.host?.memory, params.memory);

  if (
    (!projectRules || projectRules.length === 0) &&
    (!skills || skills.length === 0) &&
    (!memory || memory.length === 0)
  ) {
    return undefined;
  }

  return {
    ...(projectRules && projectRules.length > 0 ? { projectRules } : {}),
    ...(skills && skills.length > 0 ? { skills } : {}),
    ...(memory && memory.length > 0 ? { memory } : {}),
  };
}

function mergeBlocks(
  host: readonly InstructionBlock[] | undefined,
  selected: readonly InstructionBlock[] | undefined,
): InstructionBlock[] | undefined {
  if ((!host || host.length === 0) && (!selected || selected.length === 0)) {
    return undefined;
  }

  const byId = new Map<string, InstructionBlock>();
  for (const block of host ?? []) {
    byId.set(block.id, {
      id: block.id,
      title: block.title,
      content: block.content,
      priority: block.priority,
    });
  }
  for (const block of selected ?? []) {
    if (byId.has(block.id)) {
      continue;
    }
    byId.set(block.id, {
      id: block.id,
      title: block.title,
      content: block.content,
      priority: block.priority,
    });
  }
  return [...byId.values()];
}
