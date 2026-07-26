import type { LlmProvider } from '../../../kernel/llm/types';
import type { MemoryService, ObservationType } from '../../../features/ce/memory/MemoryService';
import type { ToolCallAudit } from '../../../kernel/tools/types';
import { PostTaskMemoryWorker } from '../../../features/ce/memory/PostTaskMemoryWorker';
import type { AutoMemoryFileWriter } from '../../../features/ce/memory/AutoMemoryFileWriter';
import { createLogger } from '../../../kernel/telemetry/Logger';

const log = createLogger('MemoryExtractor');

/** Post-task summarization is fire-and-forget background work — a hung provider call must
 *  never block indefinitely (it can stall process exit in the CLI, or leak in long-running
 *  daemon/server contexts). LlmProvider has no AbortSignal support, so bound each iterator
 *  step manually and abandon the summary if the model doesn't respond in time. */
const LLM_SUMMARIZE_TIMEOUT_MS = 15_000;

export class MemoryExtractor {
  private readonly worker = new PostTaskMemoryWorker();

  constructor(
    private readonly memoryService: MemoryService,
    private readonly summarizeAfterTask: boolean,
    private readonly autoMemoryWriter?: AutoMemoryFileWriter
  ) {}

  /** Queue post-task extraction asynchronously — does not block the UI. */
  extractAfterTask(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    toolAudit: ToolCallAudit[],
    provider?: LlmProvider
  ): void {
    this.worker.enqueue(() =>
      this.runExtraction(sessionId, userMessage, assistantResponse, toolAudit, provider)
    );
  }

  private async runExtraction(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    toolAudit: ToolCallAudit[],
    provider?: LlmProvider
  ): Promise<void> {
    const filesTouched = new Set<string>();
    for (const entry of toolAudit) {
      const input = entry.input as Record<string, unknown>;
      if (typeof input.path === 'string') filesTouched.add(input.path);
    }

    if (filesTouched.size > 0) {
      const observation = this.memoryService.write(
        sessionId,
        'file_fact',
        `Modified files: ${[...filesTouched].join(', ')}`,
        [...filesTouched]
      );
      if (observation) this.autoMemoryWriter?.writeObservation(observation);
    }

    const type = inferObservationType(userMessage, assistantResponse);
    const heuristic = buildHeuristicSummary(userMessage, assistantResponse, toolAudit);
    if (heuristic) {
      const observation = this.memoryService.write(sessionId, type, heuristic, [...filesTouched]);
      if (observation) this.autoMemoryWriter?.writeObservation(observation);
    }

    if (this.summarizeAfterTask && provider) {
      await this.llmSummarize(sessionId, userMessage, assistantResponse, [...filesTouched], provider);
    }

    log.info('Memory extracted', { sessionId, files: filesTouched.size });
  }

  private async llmSummarize(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    files: string[],
    provider: LlmProvider
  ): Promise<void> {
    const prompt = [
      'Summarize this coding task outcome in 2-3 sentences for future sessions.',
      'Focus on decisions, patterns, and what was changed. No secrets.',
      '',
      `User: ${userMessage.slice(0, 500)}`,
      `Assistant: ${assistantResponse.slice(0, 800)}`,
      files.length ? `Files: ${files.join(', ')}` : '',
    ].join('\n');

    let summary = '';
    try {
      const iterator = provider.complete({
        messages: [
          { role: 'system', content: 'You extract durable coding session memories. Be concise.' },
          { role: 'user', content: prompt },
        ],
        stream: false,
        // See intentClassifier.ts: reasoning models spend tokens on hidden thinking
        // before content, so a tight budget here silently yields an empty summary.
        maxTokens: 800,
        reasoningEffort: 'low',
      })[Symbol.asyncIterator]();

      while (true) {
        const step = await Promise.race([
          iterator.next(),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), LLM_SUMMARIZE_TIMEOUT_MS)),
        ]);
        if (step === 'timeout') {
          log.warn('Post-task memory summarization timed out; abandoning', { sessionId });
          await iterator.return?.(undefined)?.catch(() => undefined);
          break;
        }
        if (step.done) break;
        if (step.value.content) summary += step.value.content;
      }

      if (summary.trim()) {
        const observation = this.memoryService.write(sessionId, 'decision', summary.trim(), files);
        if (observation) this.autoMemoryWriter?.writeObservation(observation);
      }
    } catch {
      // Non-fatal
    }
  }
}

function inferObservationType(userMessage: string, response: string): ObservationType {
  const text = `${userMessage} ${response}`.toLowerCase();
  if (/bug|fix|error|broken/.test(text)) return 'bugfix';
  if (/refactor|restructure|rename/.test(text)) return 'refactor';
  if (/architect|design|pattern|structure/.test(text)) return 'architecture';
  return 'decision';
}

function buildHeuristicSummary(
  userMessage: string,
  response: string,
  audit: ToolCallAudit[]
): string | null {
  const toolsUsed = [...new Set(audit.map((a) => a.toolName))];
  const parts: string[] = [];

  if (userMessage.length > 0) {
    parts.push(`Task: ${userMessage.slice(0, 200)}`);
  }
  if (toolsUsed.length > 0) {
    parts.push(`Tools: ${toolsUsed.join(', ')}`);
  }
  const firstLine = response.split('\n').find((l) => l.trim().length > 10);
  if (firstLine) {
    parts.push(`Outcome: ${firstLine.slice(0, 200)}`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
