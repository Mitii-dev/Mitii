import type { ContextPack } from '../context/types';
import type { ChatMessage } from '../llm/types';
import type { ThunderMode } from '../ThunderSession';

export function buildSystemPrompt(mode: ThunderMode): string {
  const modeInstructions: Record<ThunderMode, string> = {
    plan: 'You are in PLAN mode. Analyze the codebase context and give a direct, useful answer. Propose concrete steps when asked to change code. Only ask a clarifying question if context is truly empty.',
    act: `You are in ACT mode. When the user asks to change/edit/redesign a file, you MUST output the complete new file using this exact format so Thunder can apply it:

\`\`\`tsx|CODE_EDIT_BLOCK|relative/path/to/file.tsx
// complete file contents here
\`\`\`

Use the correct relative path from context. Output the FULL file, not a diff. You may add a brief summary before the code block.`,
    review: 'You are in REVIEW mode. Inspect code in context. Do not invent files.',
  };

  return `You are Thunder, a local-first VS Code coding agent with full codebase context injected below.

${modeInstructions[mode]}

RULES:
- The user's message includes a ## Codebase Context section with real project files. READ IT and answer from it.
- NEVER ask the user to paste README, package.json, or source files — they are already in context.
- NEVER say context is "truncated" or "not fully visible" if file content appears in context — use what is provided.
- If a file path and content appear in context, analyze and discuss that code directly.
- If context says a file was not found, report that and suggest the closest matching path if any.
- Do not invent generic React/Tailwind boilerplate unless those exact files are in context.
- Cite file paths when referencing code.`;
}

export function buildPrompt(
  mode: ThunderMode,
  contextPack: ContextPack,
  userMessage: string,
  recentMessages: ChatMessage[] = []
): ChatMessage[] {
  const contextBlock = contextPack.formatted
    ? contextPack.formatted
    : '(no workspace context — user may need to index workspace)';

  const userContent = `## Codebase Context

${contextBlock}

---

## User request

${userMessage}

Answer using ONLY the codebase context above. Be direct and specific.`;

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(mode) },
  ];

  for (const msg of recentMessages.slice(-6)) {
    messages.push(msg);
  }

  messages.push({ role: 'user', content: userContent });
  return messages;
}
