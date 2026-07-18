import type { LlmProvider } from '../llm/types';
import { buildCommitMessagePrompt, validateCommitMessage } from './commitMessagePrompt';
import type { CommitMessageInput, CommitMessageResult } from './commitMessageTypes';

export async function generateCommitMessage(
  input: CommitMessageInput,
  provider: LlmProvider
): Promise<CommitMessageResult> {
  validateCommitMessageInput(input);
  const prompt = buildCommitMessagePrompt(input);
  let text = await collectCommitMessage(provider, {
    messages: [
      {
        role: 'system',
        content: 'You write concise, accurate Git commit messages for a coding agent. Return only the message.',
      },
      { role: 'user', content: prompt },
    ],
    stream: true,
    toolChoice: 'none',
    // See intentClassifier.ts: reasoning models burn tokens on hidden thinking before
    // content, so a tight budget here can return an empty message on those backends.
    maxTokens: 900,
    reasoningEffort: 'low',
  });

  const validation = validateCommitMessage(text);
  if (!validation.valid && validation.corrected) {
    const correctedValidation = validateCommitMessage(validation.corrected);
    if (correctedValidation.valid) text = validation.corrected;
  }

  return normalizeCommitMessage(text);
}

export function normalizeCommitMessage(raw: string): CommitMessageResult {
  const cleaned = raw
    .replace(/^```(?:gitcommit|text)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const lines = cleaned.split(/\r?\n/).map((line) => line.trimEnd());
  const subject = truncateSubject((lines.find((line) => line.trim()) ?? 'chore: update workspace').trim());
  const bodyLines = lines.slice(lines.findIndex((line) => line.trim()) + 1).join('\n').trim();
  const body = bodyLines || undefined;
  return {
    subject,
    body,
    fullMessage: body ? `${subject}\n\n${body}` : subject,
  };
}

function validateCommitMessageInput(input: CommitMessageInput): void {
  if (!input.stagedDiff.trim()) {
    throw new Error('No staged changes found. Stage files before generating a commit message.');
  }
}

async function collectCommitMessage(
  provider: LlmProvider,
  request: Parameters<LlmProvider['complete']>[0]
): Promise<string> {
  let text = '';
  for await (const delta of provider.complete(request)) {
    if (delta.error) throw new Error(delta.error);
    if (delta.content) text += delta.content;
    if (delta.done) break;
  }
  return text;
}

function truncateSubject(subject: string): string {
  if (subject.length <= 72) return subject;
  return `${subject.slice(0, 69).replace(/\s+\S*$/, '')}...`;
}
