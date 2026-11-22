import { listProviderModels, resolveProviderApiKey } from '@mitii/host';

import { writeMcpSettings } from '../mcpConfig.js';
import {
  type readShipBandTables,
  saveShipBandsFromUi,
  tablesFromSnapshot,
} from '../policyLab.js';
import {
  hashSecret,
  profileFromProvider,
  readProfiles,
  upsertProfile,
  writeProfiles,
} from '../profiles.js';
import type {
  AutocompleteSettingsSnapshot,
  PolicyLabSettingsSnapshot,
  ProviderSettingsSnapshot,
  SearchSettingsSnapshot,
  SettingsProfileView,
  UiSettingsSnapshot,
  WebviewToHostMessage,
  WorkspaceSnapshotInfo,
} from '../protocol.js';
import { testProviderConnection } from '../testConnection.js';
import { loopPolicyResetKeys } from '../loopPolicySettings.js';
import { tokenBudgetResetKeys } from '../tokenBudgetSettings.js';
import { v8LoopPolicyResetKeys } from '../v8LoopPolicySettings.js';
import { configValuesEqual } from './configValues.js';
import type { SidebarContext } from './context.js';
import { autoApprovePendingApproval } from './runSuspension.js';
import {
  readAutocomplete,
  readProviderSettings,
  readSearchSettings,
  readUiSettings,
  readWorkspaceInfo,
} from './settingsReaders.js';
import { applyUiSettings } from './settingsUiWriter.js';
import {
  ConfigWriter,
  type SettingsSetMessage,
  writeAutocompleteValues,
  writeProviderValues,
  writeSearchValues,
} from './settingsWriters.js';

const EMBEDDING_SOURCES = [
  'bundled',
  'ollama',
  'openai-compatible',
  'disabled',
] as const;

/**
 * Settings read/write owner for the sidebar: persists `settings.set` patches,
 * switches profiles, tests provider connections, and tracks model discovery.
 */
export class SidebarSettingsService {
  discoveredModels: string[] = [];
  connectionOk?: boolean;
  connectionStatus?: string;
  /** Suppress config-listener bootstraps while a settings write batch is in flight. */
  settingsWriteDepth = 0;
  /** Policy Admin: which band is being edited for ship source Save. */
  policyLabEditBand: 'compact' | 'standard' | 'wide' | undefined;
  /** Unsaved draft band tables while editing Policy Admin. */
  policyLabDraftTables: ReturnType<typeof readShipBandTables> | undefined;
  private readonly writer: ConfigWriter;

  constructor(private readonly ctx: SidebarContext) {
    this.writer = new ConfigWriter(ctx.vs);
  }

  readUi(): UiSettingsSnapshot {
    return readUiSettings(this.ctx.vs, {
      editBand: this.policyLabEditBand,
      draftTables: this.policyLabDraftTables,
    });
  }

  readProvider(): Promise<ProviderSettingsSnapshot> {
    return readProviderSettings(this.ctx.vs, this.ctx.secrets, this);
  }

  readAutocomplete(): AutocompleteSettingsSnapshot {
    return readAutocomplete(this.ctx.vs);
  }

  readSearch(): Promise<SearchSettingsSnapshot> {
    return readSearchSettings(this.ctx.vs, this.ctx.secrets);
  }

  readWorkspace(): WorkspaceSnapshotInfo {
    return readWorkspaceInfo(this.ctx.vs, this.ctx.getWorkspaceRoot);
  }

  /** Policy Admin: pick the band being edited, keeping unsaved draft tables. */
  async setPolicyLabEditBand(
    message: Extract<WebviewToHostMessage, { type: 'settings.setPolicyLabEditBand' }>,
  ): Promise<void> {
    if (message.policyLab) {
      this.policyLabDraftTables = tablesFromSnapshot(message.policyLab);
    }
    this.policyLabEditBand = message.band;
    await this.ctx.sendBootstrap();
  }

  async resetTokenBudgetToDefaults(): Promise<void> {
    await this.writer.reset(tokenBudgetResetKeys());
    await this.ctx.sendBootstrap();
  }

  async resetLoopPolicyToDefaults(): Promise<void> {
    await this.writer.reset(loopPolicyResetKeys());
    await this.ctx.sendBootstrap();
  }

  async resetV8LoopPolicyToDefaults(): Promise<void> {
    await this.writer.reset(v8LoopPolicyResetKeys());
    await this.ctx.sendBootstrap();
  }

  async writeProviderSettings(
    provider: NonNullable<SettingsSetMessage['provider']>,
  ): Promise<void> {
    await writeProviderValues(this.writer, provider);
    this.connectionOk = undefined;
    this.connectionStatus = undefined;
    this.ctx.invalidateClient();
    // Model rediscovery is owned by handleSettingsSet / explicit Refresh models
    // so Save never blocks on a hung provider catalog request.
  }

  async writeSearchSettings(
    search: Partial<Pick<SearchSettingsSnapshot, 'searxngBaseUrl'>>,
  ): Promise<void> {
    await writeSearchValues(this.writer, search);
    this.ctx.invalidateClient();
  }

  async handleSettingsSet(
    message: Extract<WebviewToHostMessage, { type: 'settings.set' }>,
  ): Promise<void> {
    const cfg = this.ctx.vs.workspace.getConfiguration('mitii');
    const previousType = cfg.get<string>('provider.type') ?? 'echo';
    const previousBaseUrl = cfg.get<string>('provider.baseUrl')?.trim() ?? '';
    this.settingsWriteDepth += 1;
    try {
      try {
        await this.applySettingsSet(message);
        this.ctx.post({ type: 'settings.saved', ok: true });
      } catch (error) {
        this.ctx.post({
          type: 'settings.saved',
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : 'Settings could not be saved.',
        });
        return;
      }
      // Echo full state after the quick ack so Save never waits on bootstrap.
      await this.ctx.sendBootstrap();
      const providerPatch = message.provider;
      if (!providerPatch) {
        return;
      }
      const nextType = providerPatch.type ?? previousType;
      const nextBaseUrl =
        providerPatch.baseUrl !== undefined
          ? providerPatch.baseUrl.trim()
          : previousBaseUrl;
      const typeOrUrlChanged =
        (providerPatch.type !== undefined &&
          providerPatch.type !== previousType) ||
        (providerPatch.baseUrl !== undefined &&
          nextBaseUrl !== previousBaseUrl);
      if (!typeOrUrlChanged || nextType === 'echo') {
        return;
      }
      void this.ctx.refreshDiscoveredModels({
        notify: true,
        type: nextType,
        baseUrl: nextBaseUrl,
      }).catch(() => undefined);
    } finally {
      this.settingsWriteDepth = Math.max(0, this.settingsWriteDepth - 1);
    }
  }

  async applySettingsSet(
    message: Extract<WebviewToHostMessage, { type: 'settings.set' }>,
  ): Promise<void> {
    const cfg = this.ctx.vs.workspace.getConfiguration('mitii');
    const target = this.writer.target();
    const update = async (key: string, value: unknown): Promise<void> => {
      if (configValuesEqual(cfg.get(key), value)) return;
      try {
        await cfg.update(key, value, target);
      } catch (error) {
        if (error instanceof Error && /not a registered configuration/i.test(error.message)) {
          throw new Error(`${error.message} Reload the VS Code window to load the extension's updated settings schema, then save again.`);
        }
        throw error;
      }
    };
    const approvalMode = message.approvalMode ?? message.ui?.approvalMode;
    if (approvalMode !== undefined) {
      await update('safety.approvalMode', approvalMode);
      if (this.ctx.session.runCancel) this.ctx.session.liveApprovalMode = approvalMode;
      autoApprovePendingApproval(this.ctx, approvalMode);
    }
    if (message.provider) {
      await this.writeProviderSettings(message.provider);
    }
    if (message.autocomplete) {
      await writeAutocompleteValues(this.writer, message.autocomplete);
    }
    if (message.search) {
      await this.writeSearchSettings(message.search);
    }
    if (message.ui) {
      await applyUiSettings(message.ui, update, cfg, () =>
        this.ctx.invalidateClient(),
      );
    }
    if (message.workspaceRootOverride !== undefined) {
      await update('workspace.rootPathOverride', message.workspaceRootOverride);
    }
    if (message.workspaceMaximumIndexFiles !== undefined) {
      const value = Number(message.workspaceMaximumIndexFiles);
      await update(
        'workspace.maximumIndexFiles',
        Number.isFinite(value)
          ? Math.max(0, Math.min(240_000, Math.floor(value)))
          : 0,
      );
    }
    if (message.mcp) {
      await writeMcpSettings(this.ctx.vs, this.ctx.effectiveRoot(), message.mcp);
      this.ctx.invalidateClient();
    }
    if (message.semanticIndex?.source) {
      const source = EMBEDDING_SOURCES.includes(message.semanticIndex.source)
        ? message.semanticIndex.source
        : undefined;
      if (source) {
        await update('semanticIndex.source', source);
        await update('semanticIndex.backend', source === 'disabled' ? 'disabled' : source);
        if (source === 'disabled') {
          await update('semanticIndex.enabled', false);
        } else {
          await update('semanticIndex.enabled', true);
        }
        this.ctx.invalidateClient();
      }
    }
    if (message.profile) {
      const root = this.ctx.effectiveRoot();
      const secret = await this.ctx.secrets.get('mitii.provider.apiKey');
      const currentProvider = await this.readProvider();
      const profilesFile = readProfiles(
        root,
        currentProvider,
        hashSecret(secret),
        this.readUi(),
      );
      const currentUi = this.readUi();
      const savedProfile: SettingsProfileView = {
        ...message.profile,
        provider: {
          ...message.profile.provider,
          type: message.provider?.type ?? message.profile.provider.type,
          preset: message.provider?.preset ?? message.profile.provider.preset,
          baseUrl: message.provider?.baseUrl ?? message.profile.provider.baseUrl,
          model: message.provider?.model ?? message.profile.provider.model,
          contextWindow:
            message.provider?.contextWindow ??
            message.profile.provider.contextWindow,
          maximumOutputTokens:
            message.provider?.maximumOutputTokens ??
            message.profile.provider.maximumOutputTokens,
        },
        hasSecret: Boolean(secret),
        ui: currentUi,
        secretHash: hashSecret(secret),
      };
      writeProfiles(root, upsertProfile(profilesFile, savedProfile));
    }
  }

  async handleProfileSwitch(id: string): Promise<void> {
    const currentProvider = await this.readProvider();
    const currentUi = this.readUi();
    const secret = await this.ctx.secrets.get('mitii.provider.apiKey');
    const secretHash = hashSecret(secret);
    let profilesFile = readProfiles(
      this.ctx.effectiveRoot(),
      currentProvider,
      secretHash,
      currentUi,
    );
    if (profilesFile.activeProfileId === id) {
      await this.ctx.sendBootstrap();
      return;
    }
    const profile = profilesFile.profiles.find((entry) => entry.id === id);
    if (!profile) {
      this.ctx.post({ type: 'error', message: `Profile not found: ${id}` });
      return;
    }
    const outgoing = profilesFile.profiles.find(
      (entry) => entry.id === profilesFile.activeProfileId,
    );
    if (outgoing) {
      profilesFile = upsertProfile(
        profilesFile,
        profileFromProvider(currentProvider, {
          id: outgoing.id,
          name: outgoing.name,
          secretHash,
          ui: currentUi,
        }),
      );
    }
    writeProfiles(this.ctx.effectiveRoot(), {
      activeProfileId: profile.id,
      profiles: profilesFile.profiles,
    });
    if (profile.ui) {
      await this.handleSettingsSet({
        type: 'settings.set',
        provider: profile.provider,
        ui: profile.ui as any,
        approvalMode: profile.ui.approvalMode,
      });
      return;
    }
    this.settingsWriteDepth += 1;
    try {
      await this.writeProviderSettings(profile.provider);
    } finally {
      this.settingsWriteDepth = Math.max(0, this.settingsWriteDepth - 1);
    }
    await this.ctx.sendBootstrap();
  }

  async handleTestConnection(
    message: Extract<WebviewToHostMessage, { type: 'provider.testConnection' }>,
  ): Promise<void> {
    this.ctx.post({
      type: 'provider.connectionResult',
      ok: false,
      message: 'Testing…',
      testing: true,
    });
    const apiKey = resolveProviderApiKey({
      type: message.provider.type,
      env: process.env,
      secretKey:
        (await this.ctx.secrets.get('mitii.provider.apiKey')) ?? undefined,
    });
    this.discoveredModels = [];
    const result = await testProviderConnection({
      type: message.provider.type,
      baseUrl: message.provider.baseUrl,
      model: message.provider.model,
      apiKey,
    });
    this.connectionOk = result.ok;
    this.connectionStatus = result.message;
    if (result.models?.length) {
      this.discoveredModels = result.models;
    } else {
      // Use the draft URL/type from the webview — not persisted settings.
      await this.ctx.refreshDiscoveredModels({
        notify: false,
        type: message.provider.type,
        baseUrl: message.provider.baseUrl,
      });
    }
    this.ctx.post({
      type: 'provider.connectionResult',
      ok: result.ok,
      message: result.message,
      models: this.discoveredModels,
      testing: false,
    });
    if (this.discoveredModels.length > 0) {
      this.ctx.post({ type: 'provider.models', models: this.discoveredModels });
    }
    // Do not sendBootstrap here — that would wipe unsaved provider drafts.
  }

  async refreshDiscoveredModels(options: {
    notify: boolean;
    type?: string;
    baseUrl?: string;
  }): Promise<void> {
    const cfg = this.ctx.vs.workspace.getConfiguration('mitii');
    const type = options.type ?? cfg.get<string>('provider.type') ?? 'echo';
    if (type === 'echo') {
      this.discoveredModels = [];
      if (options.notify) {
        this.ctx.post({ type: 'provider.models', models: [] });
      }
      return;
    }
    const baseUrl =
      options.baseUrl?.trim() ??
      cfg.get<string>('provider.baseUrl')?.trim() ??
      '';
    const apiKey = resolveProviderApiKey({
      type,
      env: process.env,
      secretKey:
        (await this.ctx.secrets.get('mitii.provider.apiKey')) ?? undefined,
    });
    const models = await listProviderModels({
      type,
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
    });
    this.discoveredModels = models;
    if (options.notify) {
      this.ctx.post({ type: 'provider.models', models });
    }
  }

  async savePolicyLabFromUi(
    snapshot: PolicyLabSettingsSnapshot,
  ): Promise<void> {
    try {
      const written = saveShipBandsFromUi({
        snapshot,
        workspaceRoot: this.ctx.effectiveRoot() ?? this.ctx.getWorkspaceRoot(),
        extensionPath: this.ctx.extensionUri.fsPath,
      });
      this.policyLabEditBand = snapshot.editBand;
      this.policyLabDraftTables = tablesFromSnapshot(snapshot);
      void this.ctx.vs.window.showInformationMessage(
        `Ship bands saved to source. Rebuild @mitii/v8 before runs pick them up.\n${written.loopPath}\n${written.windowPath}`,
      );
      await this.ctx.sendBootstrap();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void this.ctx.vs.window.showErrorMessage(`Save ship bands failed: ${message}`);
    }
  }
}
