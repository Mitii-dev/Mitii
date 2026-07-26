import type { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';
import { createMitiiClient, EchoLlmPort } from '@mitii/sdk';
import type { LlmPort, ModelCapabilities, ModelEvent, ModelRequest } from '@mitii/v8';

/**
 * Phase 13 host package: activation composes @mitii/sdk only.
 * Full chat/webview/SCM parity is Phase 15 — this entry proves the package boundary.
 */
class LocalUnderstandingLlmPort implements LlmPort {
  readonly id = 'vscode-local-understanding';
  readonly capabilities: ModelCapabilities = {
    modelId: 'vscode/local-understanding',
    supportsStreaming: true,
    supportsTools: false,
    supportsParallelToolCalls: false,
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_000,
  };

  async *complete(_request: ModelRequest): AsyncIterable<ModelEvent> {
    yield {
      type: 'content_delta',
      content: JSON.stringify({
        interactionIntent: 'question',
        primaryTaskIntent: 'question',
        secondaryTaskIntents: [],
        confidence: 0.9,
        alternatives: [],
        needsClarification: false,
        reason: 'VS Code Phase 13 local understanding.',
      }),
    };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

export function activate(context: ExtensionContext): void {
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? undefined;

  const client = createMitiiClient({
    understandingLlm: new LocalUnderstandingLlmPort(),
    runLlm: new EchoLlmPort(),
    workspaceRoot,
    defaultMode: 'ask',
    defaultSessionId: 'vscode_session',
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('mitii.openChat', async () => {
      await vscode.window.showInformationMessage(
        'Mitii Phase 13: extension host uses @mitii/sdk. Full chat UI lands in Phase 15.',
      );
    }),
    vscode.commands.registerCommand('thunder.openChat', async () => {
      await vscode.commands.executeCommand('mitii.openChat');
    }),
    vscode.commands.registerCommand('mitii.showSettings', async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:mitii.mitii-ai-agent',
      );
    }),
  );

  // Retain client on the activation bag so tree-shaking cannot drop the SDK import.
  context.subscriptions.push({
    dispose: () => {
      void client;
    },
  });
}

export function deactivate(): void {
  // no-op
}
