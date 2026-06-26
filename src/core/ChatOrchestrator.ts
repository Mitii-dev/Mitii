import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import type { ThunderDb } from './indexing/ThunderDb';
import type { LlmProvider } from './llm/types';
import type { ThunderSession } from './ThunderSession';
import type { ContextItem, ContextPack } from './context/types';
import type { ContextItemView, PlanView, AgentActivityEntry, ContextBudgetView } from '../vscode/webview/messages';
import { HybridRetriever } from './context/HybridRetriever';
import { ContextBudgeter } from './context/ContextBudgeter';
import { buildPrompt } from './planning/promptBuilder';
import { parsePlanFromText, isWriteAllowed } from './planning/PlanActEngine';
import { createLogger } from './telemetry/Logger';
import { extractFileMentions } from './context/fuzzyFileMatch';
import { AutoApplyService } from './apply/AutoApplyService';
import type { ToolExecutor } from './safety/ToolExecutor';

const log = createLogger('ChatOrchestrator');

export type ContextPackCallback = (pack: ContextPack, views: ContextItemView[], budget: ContextBudgetView) => void;
export type PlanCallback = (plan: PlanView | null) => void;
export type ActivityCallback = (entry: AgentActivityEntry) => void;
export type TokenUsageCallback = (contextTokens: number, responseText: string) => void;

export class ChatOrchestrator {
  private abortController: AbortController | undefined;
  private onContextPack: ContextPackCallback | undefined;
  private onPlan: PlanCallback | undefined;
  private onActivity: ActivityCallback | undefined;
  private onTokenUsage: TokenUsageCallback | undefined;
  private toolExecutor: ToolExecutor | undefined;
  private autoApply = new AutoApplyService();

  constructor(
    private readonly retriever: HybridRetriever,
    private readonly budgeter: ContextBudgeter,
    private readonly db?: ThunderDb
  ) {}

  setContextPackCallback(cb: ContextPackCallback): void {
    this.onContextPack = cb;
  }

  setPlanCallback(cb: PlanCallback): void {
    this.onPlan = cb;
  }

  setActivityCallback(cb: ActivityCallback): void {
    this.onActivity = cb;
  }

  setTokenUsageCallback(cb: TokenUsageCallback): void {
    this.onTokenUsage = cb;
  }

  setToolExecutor(executor: ToolExecutor | undefined): void {
    this.toolExecutor = executor;
    this.autoApply = new AutoApplyService(executor);
  }

  private emitActivity(kind: AgentActivityEntry['kind'], message: string, detail?: string): void {
    this.onActivity?.({
      id: randomUUID(),
      kind,
      message,
      detail,
      timestamp: Date.now(),
    });
  }

  async *send(
    session: ThunderSession,
    provider: LlmProvider,
    userMessage: string
  ): AsyncIterable<string> {
    this.abortController = new AbortController();
    this.emitActivity('info', `Mode: ${session.mode} · Provider: ${provider.id}`);

    const editor = vscode.window.activeTextEditor;
    const currentFile = editor
      ? vscode.workspace.asRelativePath(editor.document.uri)
      : undefined;

    const openFiles: string[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input && typeof input === 'object' && 'uri' in input) {
          const uri = (input as { uri: vscode.Uri }).uri;
          if (uri.scheme === 'file') {
            openFiles.push(vscode.workspace.asRelativePath(uri));
          }
        }
      }
    }

    this.emitActivity('context', 'Retrieving workspace context…', extractFileMentions(userMessage).join(', ') || undefined);

    const items = await this.retriever.retrieve({
      text: userMessage,
      currentFile,
      openFiles,
      maxItems: 40,
    });

    this.emitActivity(
      'read',
      `Retrieved ${items.length} context items`,
      items.map((i) => i.relPath ?? i.source).slice(0, 12).join('\n')
    );

    const contextBudget = Math.floor(provider.capabilities.contextWindow * 0.75);
    const pack = this.budgeter.budget(items, contextBudget);
    const views = contextItemsToViews(pack.items);
    const budgetView = contextPackToBudgetView(pack);

    this.onContextPack?.(pack, views, budgetView);

    this.emitActivity(
      'budget',
      `Context budget: ${pack.totalTokens}/${pack.budgetLimit} tokens · ${pack.items.length}/${pack.retrievedCount} items included`,
      spillageSummary(pack)
    );

    for (const item of pack.items.slice(0, 8)) {
      this.emitActivity(
        'read',
        `Included: ${item.relPath ?? item.source}`,
        `${item.source} · ~${item.tokenEstimate} tokens`
      );
    }

    const messages = buildPrompt(session.mode, pack, userMessage);
    this.saveTurn(session.id, 'user', userMessage);

    let fullResponse = '';
    try {
      this.emitActivity('info', 'Streaming LLM response…');
      for await (const delta of provider.complete({ messages, stream: true })) {
        if (this.abortController.signal.aborted) break;
        if (delta.content) {
          fullResponse += delta.content;
          yield delta.content;
        }
        if (delta.error) throw new Error(delta.error);
      }
    } finally {
      if (fullResponse) {
        this.saveTurn(session.id, 'assistant', fullResponse);
        const parsed = parsePlanFromText(fullResponse);
        if (parsed) {
          this.onPlan?.({
            goal: parsed.goal,
            assumptions: parsed.assumptions,
            steps: parsed.steps,
          });
        }

        if (isWriteAllowed(session.mode)) {
          const applyResults = await this.autoApply.applyFromResponse(fullResponse, userMessage);
          if (applyResults.length === 0) {
            this.emitActivity(
              'info',
              'No file edits detected in response',
              'Model should use ```tsx|CODE_EDIT_BLOCK|path format in Act mode.'
            );
          }
          for (const result of applyResults) {
            this.emitActivity(
              result.pendingApproval ? 'approval' : result.success ? 'apply' : 'error',
              result.message,
              result.path
            );
          }
        } else if (/change|edit|transform|redesign|apply|write/i.test(userMessage)) {
          this.emitActivity(
            'info',
            'File edits not applied in Plan/Review mode',
            'Switch to Act mode to write files directly.'
          );
        }

        this.onTokenUsage?.(pack.totalTokens, fullResponse);
      }
    }

    log.info('Chat completed', { sessionId: session.id, tokens: pack.totalTokens });
  }

  stop(): void {
    this.abortController?.abort();
  }

  private saveTurn(sessionId: string, role: string, content: string): void {
    if (!this.db) return;
    try {
      this.db.raw.prepare(`
        INSERT INTO agent_turns (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), sessionId, role, content, Date.now());
    } catch {
      // Session may not exist in DB yet
    }
  }
}

function spillageSummary(pack: ContextPack): string {
  const parts: string[] = [];
  if (pack.truncatedCount > 0) parts.push(`${pack.truncatedCount} truncated`);
  if (pack.dropped.length > 0) {
    parts.push(`${pack.dropped.length} dropped`);
    const droppedList = pack.dropped
      .slice(0, 6)
      .map((d) => `${d.relPath ?? d.source} (${d.tokenEstimate}t, ${d.cause})`)
      .join('\n');
    parts.push(droppedList);
  }
  return parts.join('\n');
}

export function contextPackToBudgetView(pack: ContextPack): ContextBudgetView {
  return {
    retrievedCount: pack.retrievedCount,
    includedCount: pack.items.length,
    budgetLimit: pack.budgetLimit,
    usedTokens: pack.totalTokens,
    truncatedCount: pack.truncatedCount,
    dropped: pack.dropped.map((d) => ({
      source: d.source,
      relPath: d.relPath,
      reason: d.reason,
      tokenEstimate: d.tokenEstimate,
      cause: d.cause,
    })),
  };
}

export function contextItemsToViews(items: ContextItem[]): ContextItemView[] {
  return items.map((item) => ({
    id: item.id,
    source: item.source,
    relPath: item.relPath,
    reason: item.reason,
    tokenEstimate: item.tokenEstimate,
    preview: item.content.slice(0, 300),
    truncated: item.reason.includes('truncated'),
  }));
}
