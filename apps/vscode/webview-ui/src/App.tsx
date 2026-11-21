import { type AppApi } from './app/appApi';
import { postToHost } from './bridge';
import { AutomationsPanel } from './components/AutomationsPanel';
import { ErrorBanner } from './components/ErrorBanner';
import { HistoryPanel } from './components/HistoryPanel';
import { WorkspaceBanner } from './components/WorkspaceBanner';
import { ChatView } from './containers/ChatView';
import { OnboardingView } from './containers/OnboardingView';
import { SettingsView } from './containers/SettingsView';
import { ShellHeader } from './containers/ShellHeader';
import { useAutomations } from './hooks/useAutomations';
import { useComposer } from './hooks/useComposer';
import { useHostMessages } from './hooks/useHostMessages';
import { useIndexStatus } from './hooks/useIndexStatus';
import { useIntensity } from './hooks/useIntensity';
import { useReviewState } from './hooks/useReviewState';
import { useRunStream } from './hooks/useRunStream';
import { useSettingsActions } from './hooks/useSettingsActions';
import { useSettingsState } from './hooks/useSettingsState';
import { useShellNav } from './hooks/useShellNav';
import { useThreads } from './hooks/useThreads';

export function App() {
  const api0 = { ...useShellNav() };
  const api1 = { ...api0, ...useIntensity() };
  const api2 = { ...api1, ...useIndexStatus() };
  const api3 = { ...api2, ...useThreads() };
  const api4 = { ...api3, ...useSettingsState() };
  const api5 = { ...api4, ...useRunStream(api4) };
  const api6 = { ...api5, ...useReviewState(api5) };
  const api7 = { ...api6, ...useSettingsActions(api6) };
  const api8 = { ...api7, ...useComposer(api7) };
  const api9 = { ...api8, ...useAutomations(api8) };
  const api: AppApi = api9;
  useHostMessages(api);

  const {
    activeThreadId,
    automationError,
    automationLoading,
    automationRuns,
    automationSpecs,
    error,
    history,
    nav,
    navigate,
    notice,
    onboardingRequired,
    requestAutomations,
    setError,
    workspace,
  } = api;

  if (onboardingRequired) return <OnboardingView api={api} />;

  return (
    <div className="app">
      <ShellHeader api={api} />

      <ErrorBanner
        error={error}
        onDismiss={() => setError(null)}
        onSettings={() => navigate('settings', 'model')}
      />
      <WorkspaceBanner notice={notice} workspace={workspace} />

      {nav === 'chat' ? <ChatView api={api} /> : null}

      {nav === 'history' ? (
        <HistoryPanel
          threads={history}
          activeThreadId={activeThreadId}
          onOpen={(id) => postToHost({ type: 'openChatThread', id })}
          onDelete={(id) => postToHost({ type: 'deleteChatThread', id })}
          onClear={() => postToHost({ type: 'clearChatHistory' })}
        />
      ) : null}

      {nav === 'settings' ? <SettingsView api={api} /> : null}

      {nav === 'automations' ? (
        <AutomationsPanel
          specs={automationSpecs}
          runs={automationRuns}
          loading={automationLoading}
          error={automationError}
          onRefresh={requestAutomations}
        />
      ) : null}
    </div>
  );
}
