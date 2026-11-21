import * as vscode from 'vscode';

import type { ActivationRuntime } from './runtime.js';

/** Secret-storage key commands and the autocomplete toggle. */
export function registerApiKeyCommands(
  rt: ActivationRuntime,
): vscode.Disposable[] {
  const { context, channel, invalidateClient } = {
    ...rt,
    invalidateClient: () => rt.invalidateClient(),
  };
  const setApiKey = async (): Promise<void> => {
    const key = await vscode.window.showInputBox({
      prompt: 'Provider API key (stored in SecretStorage as mitii.provider.apiKey)',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'sk-…',
    });
    if (key === undefined) return;
    const trimmed = key.trim();
    if (!trimmed) {
      void vscode.window.showWarningMessage('API key not set (empty).');
      return;
    }
    await context.secrets.store('mitii.provider.apiKey', trimmed);
    invalidateClient();
    channel.appendLine('[mitii] SecretStorage mitii.provider.apiKey updated');
    void vscode.window.showInformationMessage(
      'Mitii API key saved. Choose Anthropic, Gemini, DeepSeek, OpenAI, or a custom OpenAI-compatible endpoint in Settings. Local Ollama does not need a key.',
    );
  };

  const clearApiKey = async (): Promise<void> => {
    await context.secrets.delete('mitii.provider.apiKey');
    invalidateClient();
    channel.appendLine('[mitii] SecretStorage mitii.provider.apiKey cleared');
    void vscode.window.showInformationMessage('Mitii API key cleared.');
  };

  const setSearchApiKey = async (): Promise<void> => {
    const key = await vscode.window.showInputBox({
      prompt:
        'Brave Search API key (stored in SecretStorage as mitii.search.apiKey)',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'BSA…',
    });
    if (key === undefined) return;
    const trimmed = key.trim();
    if (!trimmed) {
      void vscode.window.showWarningMessage('Web search API key not set (empty).');
      return;
    }
    await context.secrets.store('mitii.search.apiKey', trimmed);
    invalidateClient();
    channel.appendLine('[mitii] SecretStorage mitii.search.apiKey updated');
    void vscode.window.showInformationMessage(
      'Mitii Brave web search key saved. Prefer mitii.search.searxngBaseUrl for free SearXNG; Tavily via TAVILY_API_KEY. External/product asks grant web_search when a provider is configured.',
    );
  };

  const clearSearchApiKey = async (): Promise<void> => {
    await context.secrets.delete('mitii.search.apiKey');
    invalidateClient();
    channel.appendLine('[mitii] SecretStorage mitii.search.apiKey cleared');
    void vscode.window.showInformationMessage('Mitii web search API key cleared.');
  };

  const toggleAutocomplete = async (): Promise<void> => {
    const cfg = vscode.workspace.getConfiguration('mitii');
    const current = cfg.get<boolean>('autocomplete.enabled') === true;
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await cfg.update('autocomplete.enabled', !current, target);
    void vscode.window.showInformationMessage(
      `Mitii autocomplete ${current ? 'disabled' : 'enabled'}.`,
    );
  };
  return [
    vscode.commands.registerCommand('mitii.setApiKey', setApiKey),
    vscode.commands.registerCommand('mitii.clearApiKey', clearApiKey),
    vscode.commands.registerCommand('mitii.setSearchApiKey', setSearchApiKey),
    vscode.commands.registerCommand('mitii.clearSearchApiKey', clearSearchApiKey),
    vscode.commands.registerCommand(
      'mitii.toggleAutocomplete',
      toggleAutocomplete,
    ),
  ];
}
