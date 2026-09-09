import { relative } from 'node:path';
import type * as vscode from 'vscode';
import { isSecurityConcern, WorkspaceIgnorePolicy } from '@mitii/v8';

import { sliceFimContext } from './fim.js';
import { OpenAiCompatibleFimClient } from './openAiCompatibleFimClient.js';
import {
  readAutocompleteSettings,
  resolveAutocompleteRuntimeSettings,
} from './settings.js';

interface CachedCompletion {
  text: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 48;

export class MitiiInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private readonly ignorePolicy = new WorkspaceIgnorePolicy();
  private readonly cache = new Map<string, CachedCompletion>();
  private activeAbortController: AbortController | undefined;
  private sequence = 0;

  constructor(
    private readonly vs: typeof vscode,
    private readonly secrets: vscode.SecretStorage,
    private readonly getWorkspaceRoot: () => string | undefined,
    private readonly channel: vscode.OutputChannel,
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const settings = this.resolveSettings();
    if (!settings.enabled) return undefined;
    if (!this.shouldRequest(document)) return undefined;

    const offset = document.offsetAt(position);
    const context = sliceFimContext({
      text: document.getText(),
      offset,
      prefixChars: settings.prefixChars,
      suffixChars: settings.suffixChars,
    });
    if (!context.prefix.trim()) return undefined;

    const key = this.cacheKey(document, position, context.prefix, context.suffix);
    const cached = this.getCached(key);
    if (cached) return [this.toCompletionItem(this.vs, cached, position)];

    if (!(await this.waitForDebounce(settings.debounceMs, token))) {
      return undefined;
    }

    const requestId = ++this.sequence;
    const abortController = new AbortController();
    this.activeAbortController?.abort();
    this.activeAbortController = abortController;
    const disposable = token.onCancellationRequested(() => {
      abortController.abort();
    });
    try {
      const client = new OpenAiCompatibleFimClient({
        baseUrl: settings.baseUrl,
        endpointPath: settings.endpointPath,
        authHeader: settings.authHeader,
        apiKey:
          (await this.secrets.get('mitii.provider.apiKey')) ?? undefined,
        timeoutMs: settings.timeoutMs,
      });
      const result = await client.complete({
        ...context,
        model: settings.model,
        maxTokens: settings.maxTokens,
        temperature: settings.temperature,
        abortSignal: abortController.signal,
      });
      if (requestId !== this.sequence || token.isCancellationRequested) {
        return undefined;
      }
      if (!result.text.trim()) return undefined;
      this.setCached(key, result.text);
      return [this.toCompletionItem(this.vs, result.text, position)];
    } catch (error) {
      this.channel.appendLine(
        `[autocomplete] completion failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    } finally {
      disposable.dispose();
      if (this.activeAbortController === abortController) {
        this.activeAbortController = undefined;
      }
    }
  }

  private resolveSettings() {
    const cfg = this.vs.workspace.getConfiguration('mitii');
    return resolveAutocompleteRuntimeSettings({
      autocomplete: readAutocompleteSettings(cfg),
      providerBaseUrl: cfg.get<string>('provider.baseUrl') ?? '',
      providerModel: cfg.get<string>('provider.model') ?? '',
    });
  }

  private shouldRequest(document: vscode.TextDocument): boolean {
    if (this.vs.workspace.isTrusted === false) return false;
    if (document.uri.scheme !== 'file') return false;
    if (document.isClosed) return false;
    if (document.lineCount > 100_000) return false;
    const relPath = this.relativePath(document);
    if (isSecurityConcern(relPath)) return false;
    return !this.ignorePolicy.shouldIgnore({
      path: document.uri.fsPath,
      relativePath: relPath,
      kind: 'file',
    });
  }

  private relativePath(document: vscode.TextDocument): string {
    const root = this.getWorkspaceRoot();
    if (!root) return document.uri.fsPath;
    return relative(root, document.uri.fsPath).replace(/\\/g, '/');
  }

  private async waitForDebounce(
    debounceMs: number,
    token: vscode.CancellationToken,
  ): Promise<boolean> {
    if (token.isCancellationRequested) return false;
    if (debounceMs <= 0) return !token.isCancellationRequested;
    return new Promise((resolve) => {
      let disposable: vscode.Disposable | undefined;
      const timer = setTimeout(() => {
        disposable?.dispose();
        resolve(!token.isCancellationRequested);
      }, debounceMs);
      disposable = token.onCancellationRequested(() => {
        clearTimeout(timer);
        disposable?.dispose();
        resolve(false);
      });
    });
  }

  private cacheKey(
    document: vscode.TextDocument,
    position: vscode.Position,
    prefix: string,
    suffix: string,
  ): string {
    return [
      document.uri.toString(),
      document.version,
      position.line,
      position.character,
      hashText(prefix),
      hashText(suffix),
    ].join(':');
  }

  private getCached(key: string): string | undefined {
    const cached = this.cache.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return cached.text;
  }

  private setCached(key: string, text: string): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { text, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  private toCompletionItem(
    vs: typeof vscode,
    text: string,
    position: vscode.Position,
  ): vscode.InlineCompletionItem {
    return new vs.InlineCompletionItem(text, new vs.Range(position, position));
  }
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
