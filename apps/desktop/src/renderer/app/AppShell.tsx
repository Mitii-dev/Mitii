/** Application shell layout (composition of shell and chat containers). */

import { OnboardingPanel } from '../shell/OnboardingPanel.js';
import { workspaceLabel, shortPath } from '../api.js';
import type { AppModel } from './useAppModel.js';
import { WorkspaceLoader } from '../shell/WorkspaceLoader.js';
import { AppTopbar } from '../shell/AppTopbar.js';
import { HistorySidebar } from '../chat/HistorySidebar.js';
import { ActivityBar } from '../shell/ActivityBar.js';
import { MainSection } from '../shell/MainSection.js';
import { PickerOverlay } from '../shell/PickerOverlay.js';

export function AppShell({ m }: { m: AppModel }) {
  const {
    inCodeMode,
    showOnboarding,
    view,
    snapshot,
    profiles,
    activeProfileId,
    indexIndexing,
    indexStatus,
    indexProgress,
    busy,
    onPickWorkspace,
    onSwitchWorkspace,
    onForgetWorkspace,
    onSelectProfile,
    onCreateProfileFromPreset,
    setSettingsTab,
    setView,
    runReindex,
    completeOnboarding,
  } = m;

  return (
    <div className={`app${inCodeMode ? ' app--code' : ''}`}>
      <WorkspaceLoader m={m} />
      <AppTopbar m={m} />

      <div className="app-body">
      <HistorySidebar m={m} />
      <ActivityBar m={m} />
      <MainSection m={m} />
      </div>

      <PickerOverlay m={m} />
      {showOnboarding && view !== 'settings' ? (
        <OnboardingPanel
          workspaceRoot={snapshot?.workspaceRoot ?? ''}
          workspaceCards={(snapshot?.recentWorkspaces ?? []).map((path) => ({
            id: path,
            title: workspaceLabel(path),
            subtitle: shortPath(path),
            active: path === snapshot?.workspaceRoot,
          }))}
          profiles={profiles.map((profile) => ({
            id: profile.id,
            name: profile.name,
            subtitle: profile.provider.model || profile.provider.preset,
          }))}
          activeProfileId={activeProfileId}
          indexing={indexIndexing}
          indexed={Boolean(
            indexStatus?.indexed && (indexStatus?.fileCount ?? 0) > 0,
          )}
          indexStatus={indexStatus?.message}
          indexProgress={indexProgress}
          busy={busy}
          onPickWorkspace={() => void onPickWorkspace()}
          onSelectWorkspace={(path) => void onSwitchWorkspace(path)}
          onForgetWorkspace={(path) => void onForgetWorkspace(path)}
          onSelectProfile={(id) => void onSelectProfile(id)}
          onCreateProfileFromPreset={(preset) =>
            void onCreateProfileFromPreset(preset)
          }
          onManageProfiles={() => {
            setSettingsTab('profiles');
            setView('settings');
          }}
          onStartIndex={() => void runReindex()}
          onComplete={() => void completeOnboarding()}
          onSkip={() => void completeOnboarding()}
        />
      ) : null}
    </div>
  );
}
