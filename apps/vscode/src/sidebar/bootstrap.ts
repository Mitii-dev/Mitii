import { resolveModelCostRates } from '@mitii/host';

import { loadCheckpoints, loadHistory, toThreadSummaries } from '../chatHistory.js';
import { getSharedMcpManager } from '../mcp/manager.js';
import {
  readMcpSettings,
  readMcpStoreCatalog,
} from '../mcpConfig.js';
import { loadMemoriesForView } from '../memoryStore.js';
import { planViewFromArtifact } from '../planView.js';
import { hashSecret, readProfiles } from '../profiles.js';
import type {
  McpRuntimeStatus,
  ProviderSettingsSnapshot,
} from '../protocol.js';
import { getWorkspaceTrustSnapshot } from '../workspace/trust.js';
import type { SidebarServices } from './services.js';

function mcpRuntimeStatus(svc: SidebarServices): McpRuntimeStatus {
  const mcp = readMcpSettings(svc.vs, svc.effectiveRoot());
  if (!mcp.enabled) return 'disabled';
  const active = mcp.servers.filter((s) =>
    typeof s.enabled === 'boolean' ? s.enabled : !s.disabled,
  );
  if (active.length === 0) return 'configured';

  const snapshot = getSharedMcpManager().snapshot();
  if (!snapshot.enabled) return 'disabled';
  const ready = snapshot.servers.filter((s) => s.status === 'ready').length;
  const errored = snapshot.servers.filter((s) => s.status === 'error').length;
  if (ready > 0 && errored === 0) return 'ready';
  if (ready > 0 && errored > 0) return 'partial';
  if (errored > 0) return 'error';
  if (snapshot.toolDefinitions.length > 0) return 'ready';
  return 'configured';
}

export async function sendBootstrap(svc: SidebarServices): Promise<void> {
  const history = loadHistory(svc.host.workspaceState);
  const activeThread = history.activeThreadId
    ? history.threads.find((thread) => thread.id === history.activeThreadId)
    : undefined;
  const onboardingCompleted =
    svc.vs.workspace
      .getConfiguration('mitii')
      .get<boolean>('onboarding.completed') ?? false;
  svc.session.activeThreadId = history.activeThreadId;
  svc.tokens.activateThread(
    svc.session.activeThreadId,
    activeThread?.tokenUsage,
  );
  const provider = await svc.settings.readProvider();
  const autocomplete = svc.settings.readAutocomplete();
  const search = await svc.settings.readSearch();
  const ui = svc.settings.readUi();
  const secretHash = hashSecret(await svc.secrets.get('mitii.provider.apiKey'));
  const profilesFile = readProfiles(
    svc.effectiveRoot(),
    provider,
    secretHash,
    ui,
  );
  svc.post({
    type: 'bootstrap',
    workspace: svc.settings.readWorkspace(),
    provider,
    autocomplete,
    search,
    profiles: profilesFile.profiles,
    activeProfileId: profilesFile.activeProfileId,
    index: await svc.indexer.withEmbedding(await svc.indexer.readIndexStatus()),
    mcp: readMcpSettings(svc.vs, svc.effectiveRoot()),
    mcpRuntimeStatus: mcpRuntimeStatus(svc),
    mcpStore: readMcpStoreCatalog(svc.effectiveRoot()),
    ui,
    tokenUsage: svc.tokens.usage,
    notice: getWorkspaceTrustSnapshot(svc.vs),
    onboardingRequired: !onboardingCompleted,
    history: toThreadSummaries(history),
    activeThreadId: history.activeThreadId,
    activeThreadMessages: activeThread?.messages ?? [],
    pendingPlan: planViewFromArtifact(activeThread?.pendingPlan),
    memories: await loadMemoriesForView(
      svc.host.workspaceState,
      svc.getWorkspaceId(),
    ),
    checkpoints: loadCheckpoints(svc.host.workspaceState),
  });
  void refreshModelPricing(svc, provider);
}

async function refreshModelPricing(
  svc: SidebarServices,
  provider?: ProviderSettingsSnapshot,
): Promise<void> {
  try {
    const snap = provider ?? (await svc.settings.readProvider());
    const rates = await resolveModelCostRates({
      presetOrType: snap.preset || snap.type,
      modelId: snap.model,
      baseUrl: snap.baseUrl,
    });
    svc.post({ type: 'modelPricing', rates });
  } catch {
    svc.post({ type: 'modelPricing', rates: null });
  }
}
