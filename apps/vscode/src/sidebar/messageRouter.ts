import type { WebviewToHostMessage } from '../protocol.js';
import {
  handleAddMemory,
  handleClearCheckpoints,
  handleClearMemory,
  handleDeleteCheckpoint,
  handleDeleteMemory,
  handleRequestSkillCatalog,
  handleRestoreCheckpoint,
} from './handlers/checkpointMemoryHandlers.js';
import {
  handleApproveAllPending,
  handleCompleteOnboarding,
  handleCopyLastResponse,
  handlePathsSearch,
  handlePickContextPath,
  handleRefreshReviewDiff,
  handleToggleContextSource,
} from './handlers/contextHandlers.js';
import {
  handleOpenDiffPreview,
  handleReviewCheckpointChanges,
  handleReviewFileChange,
  handleReviewWorkspaceFile,
  handleUndoFileChanges,
  openWorkspaceFile,
  showInlineDiffForApproval,
} from './handlers/fileHandlers.js';
import { handleFixReviewFindings } from './handlers/reviewHandlers.js';
import {
  handleClearChatHistory,
  handleClearPendingPlan,
  handleDeleteChatThread,
  handleNewChat,
  handleOpenChatThread,
} from './handlers/threadHandlers.js';
import type { SidebarServices } from './services.js';

/**
 * Inbound dispatch for validated webview messages. Each case delegates to the
 * owning service or handler; no business logic lives here.
 */
export async function routeWebviewMessage(
  svc: SidebarServices,
  message: WebviewToHostMessage,
): Promise<void> {
  if (!message || typeof message !== 'object') return;
  switch (message.type) {
    case 'ready':
      // Post a quick bootstrap first, then continue index work in the background.
      await svc.sendBootstrap();
      void svc.refreshDiscoveredModels({ notify: true });
      svc.indexer.startBackgroundIndex('initial load');
      return;
    case 'ask':
      await svc.runs.ask(message);
      return;
    case 'cancel':
      svc.runs.cancel();
      return;
    case 'resume':
      svc.runs.resume(message);
      return;
    case 'navigate':
    case 'setTab':
      return;
    case 'clearPendingPlan':
      await handleClearPendingPlan(svc);
      return;
    case 'newChat':
      await handleNewChat(svc);
      return;
    case 'openChatThread':
      await handleOpenChatThread(svc, message.id);
      return;
    case 'deleteChatThread':
      await handleDeleteChatThread(svc, message.id);
      return;
    case 'clearChatHistory':
      await handleClearChatHistory(svc);
      return;
    case 'completeOnboarding':
      await handleCompleteOnboarding(svc);
      return;
    case 'showInlineDiff':
      await showInlineDiffForApproval(svc, message.approvalId);
      return;
    case 'openDiffPreview':
      await handleOpenDiffPreview(svc, message);
      return;
    case 'toggleContextSource':
      await handleToggleContextSource(svc, message);
      return;
    case 'refreshReviewDiff':
      await handleRefreshReviewDiff(svc);
      return;
    case 'restoreCheckpoint':
      await handleRestoreCheckpoint(svc, message);
      return;
    case 'deleteCheckpoint':
      await handleDeleteCheckpoint(svc, message);
      return;
    case 'clearCheckpoints':
      await handleClearCheckpoints(svc);
      return;
    case 'reviewCheckpointChanges':
      await handleReviewCheckpointChanges(svc, message.id);
      return;
    case 'addMemory':
      await handleAddMemory(svc, message);
      return;
    case 'deleteMemory':
      await handleDeleteMemory(svc, message);
      return;
    case 'clearMemory':
      await handleClearMemory(svc);
      return;
    case 'requestSkillCatalog':
      await handleRequestSkillCatalog(svc, message);
      return;
    case 'requestAutomations':
    case 'automation.trigger':
    case 'automation.pause':
    case 'automation.resume': {
      const { handleAutomationHostMessage } = await import(
        '../automationHost.js'
      );
      handleAutomationHostMessage({
        message,
        post: (msg) => svc.post(msg),
        workspaceRoot: svc.getWorkspaceRoot(),
      });
      return;
    }
    case 'pickContextPath':
      await handlePickContextPath(svc);
      return;
    case 'copyLastResponse':
      await handleCopyLastResponse(svc);
      return;
    case 'approveAllPending':
      await handleApproveAllPending(svc);
      return;
    case 'settings.get':
      await svc.sendBootstrap();
      return;
    case 'settings.set':
      await svc.settings.handleSettingsSet(message);
      return;
    case 'profile.switch':
      await svc.settings.handleProfileSwitch(message.id);
      return;
    case 'settings.setApiKey':
      await svc.vs.commands.executeCommand('mitii.setApiKey');
      await svc.sendBootstrap();
      return;
    case 'settings.clearApiKey':
      await svc.vs.commands.executeCommand('mitii.clearApiKey');
      await svc.sendBootstrap();
      return;
    case 'settings.setSearchApiKey':
      await svc.vs.commands.executeCommand('mitii.setSearchApiKey');
      await svc.sendBootstrap();
      return;
    case 'settings.clearSearchApiKey':
      await svc.vs.commands.executeCommand('mitii.clearSearchApiKey');
      await svc.sendBootstrap();
      return;
    case 'settings.resetTokenBudget':
      await svc.settings.resetTokenBudgetToDefaults();
      return;
    case 'settings.resetLoopPolicy':
      await svc.settings.resetLoopPolicyToDefaults();
      return;
    case 'settings.resetV8LoopPolicy':
      await svc.settings.resetV8LoopPolicyToDefaults();
      return;
    case 'settings.savePolicyLab':
      await svc.settings.savePolicyLabFromUi(message.policyLab);
      return;
    case 'settings.setPolicyLabEditBand':
      await svc.settings.setPolicyLabEditBand(message);
      return;
    case 'provider.testConnection':
      await svc.settings.handleTestConnection(message);
      return;
    case 'provider.listModels':
      await svc.refreshDiscoveredModels({
        notify: true,
        type: message.provider.type,
        baseUrl: message.provider.baseUrl,
      });
      return;
    case 'index.refresh':
      await svc.indexer.postRefreshedStatus();
      return;
    case 'index.reindex':
      await svc.indexer.reindex();
      return;
    case 'paths.search':
      await handlePathsSearch(svc, message);
      return;
    case 'openFolder':
      await svc.vs.commands.executeCommand('vscode.openFolder');
      return;
    case 'openFile':
      await openWorkspaceFile(svc, message.path, message.line, message.column);
      return;
    case 'undoFileChanges':
      await handleUndoFileChanges(svc, message.runId);
      return;
    case 'reviewFileChange':
      await handleReviewFileChange(svc, message.runId, message.path);
      return;
    case 'reviewWorkspaceFile':
      await handleReviewWorkspaceFile(svc, message.path);
      return;
    case 'dismissFileChanges':
      svc.session.fileChangeSnapshots.delete(message.runId);
      return;
    case 'dismissReviewFindings':
      svc.host.reviewFindings.clear();
      svc.post({ type: 'setReviewFindings', findings: [] });
      return;
    case 'fixReviewFindings':
      await handleFixReviewFindings(svc, message, {
        readUi: () => svc.settings.readUi(),
        runAsk: (ask) => svc.runs.ask(ask),
      });
      return;
    default:
      return;
  }
}
