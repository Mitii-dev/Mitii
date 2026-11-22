/** Code-layout activity bar. */

import { SETTINGS_TABS } from '../../shared/settings.js';
import { ActivityBarButton } from './ActivityBarButton.js';
import {
  IconFiles,
  IconGit,
  IconMcp,
  IconSkills,
  IconRecipes,
  IconChat,
  IconCode,
  IconSettings,
} from './ActivityIcons.js';
import type { AppModel } from '../app/useAppModel.js';
import { SETTINGS_TAB_ICONS } from '../settings/tabIcons.js';

export function ActivityBar({ m }: { m: AppModel }) {
  const {
    showActivityBar,
    view,
    settingsTab,
    setSettingsTab,
    inCodeMode,
    workspaceSide,
    setWorkspaceSide,
    gitBadge,
    chatLayout,
    setLayout,
    setView,
  } = m;

  return showActivityBar ? (
    <aside
      className={`activity-bar${view === 'settings' ? ' activity-bar--settings' : ''}`}
      aria-label={view === 'settings' ? 'Settings' : 'Activity bar'}
    >
      <nav
        className="activity-bar__nav"
        aria-label={view === 'settings' ? 'Settings sections' : 'Views'}
      >
        {view === 'settings'
          ? SETTINGS_TABS.map(({ id, label }) => {
              const Icon = SETTINGS_TAB_ICONS[id];
              return (
                <ActivityBarButton
                  key={id}
                  label={label}
                  active={settingsTab === id}
                  aria-current={settingsTab === id ? 'page' : undefined}
                  onClick={() => setSettingsTab(id)}
                >
                  <Icon size={22} />
                </ActivityBarButton>
              );
            })
          : null}
        {inCodeMode ? (
          <>
            <ActivityBarButton
              label="Explorer"
              active={workspaceSide === 'explorer'}
              onClick={() => setWorkspaceSide('explorer')}
            >
              <IconFiles size={22} />
            </ActivityBarButton>
            <ActivityBarButton
              label="Source Control"
              active={workspaceSide === 'git'}
              onClick={() => setWorkspaceSide('git')}
              badge={
                gitBadge > 0 ? (
                  <em className="activity-badge">{gitBadge}</em>
                ) : null
              }
            >
              <IconGit size={22} />
            </ActivityBarButton>
            <ActivityBarButton
              label="MCP"
              active={workspaceSide === 'mcp'}
              onClick={() => setWorkspaceSide('mcp')}
            >
              <IconMcp size={22} />
            </ActivityBarButton>
            <ActivityBarButton
              label="Skills"
              active={workspaceSide === 'skills'}
              onClick={() => setWorkspaceSide('skills')}
            >
              <IconSkills size={22} />
            </ActivityBarButton>
            <ActivityBarButton
              label="Recipes"
              active={workspaceSide === 'recipes'}
              onClick={() => setWorkspaceSide('recipes')}
            >
              <IconRecipes size={22} />
            </ActivityBarButton>
          </>
        ) : null}
      </nav>
      <div className="activity-bar__foot">
        <ActivityBarButton
          label="Chat mode"
          active={view === 'chat' && chatLayout === 'chat'}
          onClick={() => setLayout('chat')}
        >
          <IconChat size={22} />
        </ActivityBarButton>
        <ActivityBarButton
          label="Code mode"
          active={inCodeMode}
          onClick={() => setLayout('code')}
        >
          <IconCode size={22} />
        </ActivityBarButton>
        <ActivityBarButton
          label="Settings"
          active={view === 'settings'}
          onClick={() => setView('settings')}
        >
          <IconSettings size={22} />
        </ActivityBarButton>
      </div>
    </aside>
  ) : null;
}
