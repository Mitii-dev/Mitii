import * as vscode from 'vscode';
import { createLogger } from '../telemetry/Logger';
import { readThunderConfigFromSettings } from './vscodeSettings';
import { updateProviderSettings, updateWorkspaceOverride, clearWorkspaceOverride } from './updateSettings';
import { type ThunderConfig, defaultThunderConfig } from './schema';
import type { ProviderSettingsPayload } from '../../vscode/webview/messages';

const log = createLogger('ConfigService');

export class ConfigService {
  private config: ThunderConfig = defaultThunderConfig();
  private disposable: vscode.Disposable | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async initialize(): Promise<void> {
    this.config = readThunderConfigFromSettings();
    this.disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('thunder')) {
        this.config = readThunderConfigFromSettings();
        log.info('Configuration reloaded');
      }
    });
  }

  getConfig(): ThunderConfig {
    return this.config;
  }

  async getApiKey(ref?: string): Promise<string | undefined> {
    const keyRef = ref ?? this.config.provider.apiKeyRef;
    const value = await this.context.secrets.get(keyRef);
    return value ?? undefined;
  }

  async setApiKey(key: string, ref?: string): Promise<void> {
    const keyRef = ref ?? this.config.provider.apiKeyRef;
    await this.context.secrets.store(keyRef, key);
    log.info('API key stored securely', { ref: keyRef });
  }

  async updateProviderSettings(settings: ProviderSettingsPayload): Promise<void> {
    await updateProviderSettings(settings);
    this.config = readThunderConfigFromSettings();
    log.info('Provider settings updated');
  }

  async setWorkspaceOverride(path: string): Promise<void> {
    await updateWorkspaceOverride(path);
    this.config = readThunderConfigFromSettings();
    log.info('Workspace override updated', { path });
  }

  async clearWorkspaceOverride(): Promise<void> {
    await clearWorkspaceOverride();
    this.config = readThunderConfigFromSettings();
    log.info('Workspace override cleared');
  }

  async deleteApiKey(ref?: string): Promise<void> {
    const keyRef = ref ?? this.config.provider.apiKeyRef;
    await this.context.secrets.delete(keyRef);
    log.info('API key deleted', { ref: keyRef });
  }

  dispose(): void {
    this.disposable?.dispose();
  }
}
