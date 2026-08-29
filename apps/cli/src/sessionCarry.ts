import type {
  AgentMode,
  AgentRunResult,
  MitiiConversationMessage,
  TaskList,
} from '@mitii/sdk';

export const CLI_SESSION_CARRY_LIMITS = {
  maxMessages: 20,
  maxCharsPerMessage: 8_000,
} as const;

export interface CliSessionCarry {
  conversation: MitiiConversationMessage[];
  taskList?: TaskList;
}

/**
 * Advance interactive CLI carry after a finished run.
 * Only Agent mode forwards a live list into the next start. Plan reseeds
 * from a new artifact; Ask never owns a checklist.
 */
export function nextCliSessionCarry(options: {
  mode: AgentMode;
  conversation: MitiiConversationMessage[];
  taskList?: TaskList;
  prompt: string;
  result: AgentRunResult;
}): CliSessionCarry {
  const conversation = appendConversation(
    options.conversation,
    options.prompt,
    options.result.answer,
  );
  if (options.mode !== 'agent') {
    return { conversation };
  }
  if (options.result.taskList) {
    return { conversation, taskList: options.result.taskList };
  }
  if (options.result.status === 'cancelled' && options.taskList) {
    return { conversation, taskList: options.taskList };
  }
  return { conversation };
}

function appendConversation(
  current: MitiiConversationMessage[],
  prompt: string,
  answer: string | undefined,
): MitiiConversationMessage[] {
  const next: MitiiConversationMessage[] = [...current];
  const user = clip(prompt);
  if (user) {
    next.push({ role: 'user', content: user });
  }
  const assistant = clip(answer ?? '');
  if (assistant) {
    next.push({ role: 'assistant', content: assistant });
  }
  return next.slice(-CLI_SESSION_CARRY_LIMITS.maxMessages);
}

function clip(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const max = CLI_SESSION_CARRY_LIMITS.maxCharsPerMessage;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}
