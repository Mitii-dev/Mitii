import { useVsCodeMessaging } from './state/useVsCodeMessaging';
import { MessageList } from './components/MessageList';
import { ChatInput } from './components/ChatInput';
import { ModeIndicator } from './components/ModeIndicator';
import { ErrorBanner } from './components/ErrorBanner';
import { SettingsPanel } from './components/SettingsPanel';
import { ApprovalCards } from './components/ApprovalCards';
import { ContextPreview } from './components/ContextPreview';
import { PlanPanel } from './components/PlanPanel';
import { IndexingStatusBar } from './components/IndexingStatusBar';
import { MemoryPanel } from './components/MemoryPanel';
import { CheckpointPanel } from './components/CheckpointPanel';
import { ContextTogglesPanel } from './components/ContextTogglesPanel';
import { WorkspaceBanner } from './components/WorkspaceBanner';
import { AgentActivityPanel } from './components/AgentActivityPanel';
import { TokenMeter } from './components/TokenMeter';

export function App() {
  const { state, postMessage } = useVsCodeMessaging();

  return (
    <div className="thunder-app">
      <header className="thunder-header">
        <div className="thunder-brand">
          <span className="thunder-logo" aria-hidden="true">⚡</span>
          <h1 className="thunder-title">Thunder AI Agent</h1>
        </div>
        <nav className="thunder-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`tab-btn ${state.tab === 'chat' ? 'tab-btn--active' : ''}`}
            aria-selected={state.tab === 'chat'}
            onClick={() => postMessage({ type: 'setTab', payload: 'chat' })}
          >
            Chat
          </button>
          <button
            type="button"
            role="tab"
            className={`tab-btn ${state.tab === 'settings' ? 'tab-btn--active' : ''}`}
            aria-selected={state.tab === 'settings'}
            onClick={() => postMessage({ type: 'setTab', payload: 'settings' })}
          >
            Settings
          </button>
        </nav>
        <IndexingStatusBar
          status={state.indexing}
          onIndex={() => postMessage({ type: 'indexWorkspace' })}
        />
        <span className="provider-badge" title="Active LLM provider and model">
          {state.providerLabel}
        </span>
        <TokenMeter usage={state.tokenUsage} />
      </header>

      <ErrorBanner error={state.error} onDismiss={() => postMessage({ type: 'clearError' })} />

      <WorkspaceBanner
        workspaceOpen={state.workspaceOpen}
        workspacePath={state.workspacePath}
        vscodeWorkspaceFolders={state.vscodeWorkspaceFolders}
        usingWorkspaceOverride={state.usingWorkspaceOverride}
        indexed={state.indexing.indexed}
      />

      <ApprovalCards
        approvals={state.approvals}
        onResolve={(id, decision) => postMessage({ type: 'resolveApproval', payload: { id, decision } })}
        onApproveAll={() => postMessage({ type: 'approveAllPending' })}
      />

      {state.tab === 'chat' ? (
        <>
          <ModeIndicator
            mode={state.mode}
            onChange={(mode) => postMessage({ type: 'setMode', payload: mode })}
          />
          <ContextTogglesPanel
            toggles={state.contextToggles}
            onToggle={(source, enabled) =>
              postMessage({ type: 'toggleContextSource', payload: { source, enabled } })
            }
          />
          <ContextPreview
            items={state.contextPreview}
            totalTokens={state.contextTokenEstimate}
            budget={state.contextBudget}
            visible={state.showContextPreview}
            onToggle={() => postMessage({ type: 'toggleContextPreview' })}
          />
          <AgentActivityPanel entries={state.agentActivity} loading={state.loading} />
          <PlanPanel plan={state.plan} />
          <main className="thunder-main">
            <MessageList messages={state.messages} />
          </main>
          <div className="side-panels">
            <MemoryPanel
              memories={state.memories}
              onDelete={(id) => postMessage({ type: 'deleteMemory', payload: { id } })}
              onClear={() => postMessage({ type: 'clearMemory' })}
            />
            <CheckpointPanel
              checkpoints={state.checkpoints}
              onRestore={(id) => postMessage({ type: 'restoreCheckpoint', payload: { id } })}
            />
          </div>
          <footer className="thunder-footer">
            <div className="footer-actions">
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() => postMessage({ type: 'copyLastResponse' })}
              >
                Copy response
              </button>
            </div>
            <ChatInput
              loading={state.loading}
              onSend={(content) => postMessage({ type: 'sendMessage', payload: { content } })}
              onStop={() => postMessage({ type: 'stopGeneration' })}
            />
          </footer>
        </>
      ) : (
        <main className="thunder-main">
          <SettingsPanel
            settings={state.settings}
            workspaceOpen={state.workspaceOpen}
            workspacePath={state.workspacePath}
            vscodeWorkspaceFolders={state.vscodeWorkspaceFolders}
            workspaceOverride={state.workspaceOverride}
            usingWorkspaceOverride={state.usingWorkspaceOverride}
            indexDbPath={state.indexDbPath}
            indexed={state.indexing.indexed}
            onSaveApiKey={(key) => postMessage({ type: 'saveApiKey', payload: { key } })}
            onSaveProviderSettings={(payload) =>
              postMessage({ type: 'saveProviderSettings', payload })
            }
            onTestConnection={() => postMessage({ type: 'testProviderConnection' })}
            onPickWorkspaceFolder={() => postMessage({ type: 'pickWorkspaceFolder' })}
            onSetWorkspaceOverride={(path) =>
              postMessage({ type: 'setWorkspaceOverride', payload: { path } })
            }
            onClearWorkspaceOverride={() => postMessage({ type: 'clearWorkspaceOverride' })}
            onIndex={() => postMessage({ type: 'indexWorkspace' })}
          />
        </main>
      )}
    </div>
  );
}
