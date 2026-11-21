import SYMBOL_LOGO from '../../../media/mitii-logo.png';
import { type AppApi } from '../app/appApi';
import { EMPTY_TOKEN_USAGE } from '../app/turnHelpers';
import { postToHost } from '../bridge';
import { IconButton } from '../components/IconButton';
import { IconChat, IconHistory, IconLayers, IconPlus, IconSettings, IconChevronDown } from '../components/Icons';
import { IndexingStatusBar } from '../components/IndexingStatusBar';

export function ShellHeader({ api }: { api: AppApi }) {
  const {
    activeProfileId,
    index,
    nav,
    navigate,
    profiles,
    selectedProfileLabel,
    setActiveThreadId,
    setPendingPlan,
    setPlan,
    setTokenUsage,
    setTurns,
    settingsTab,
    switchProfile,
  } = api;

  return (
    <header className="shell-header">
      <div className="brand" aria-label=">Mitii.dev_">
        <img className="brand-symbol" src={SYMBOL_LOGO} alt="" />
      </div>
      <div className="shell-header__actions">
        <nav className="nav-pills" aria-label="Primary">
          {nav === 'chat' ? (
            <IconButton
              label="New chat"
              onClick={() => {
                postToHost({ type: 'newChat' });
                setTurns([]);
                setPlan(null);
                setPendingPlan(null);
                setActiveThreadId(undefined);
                setTokenUsage(EMPTY_TOKEN_USAGE);
              }}
            >
              <IconPlus />
            </IconButton>
          ) : null}
          <IconButton
            label="Chat"
            active={nav === 'chat'}
            onClick={() => navigate('chat')}
          >
            <IconChat />
          </IconButton>
          <IconButton
            label="History"
            active={nav === 'history'}
            onClick={() => navigate('history')}
          >
            <IconHistory />
          </IconButton>
          <IconButton
            label="Settings"
            active={nav === 'settings'}
            onClick={() => navigate('settings', settingsTab)}
          >
            <IconSettings />
          </IconButton>
          <IconButton
            label="Automations"
            active={nav === 'automations'}
            onClick={() => navigate('automations')}
          >
            <IconLayers />
          </IconButton>
        </nav>
        <IndexingStatusBar
          index={index}
          onRefresh={() => postToHost({ type: 'index.refresh' })}
          onOpenSettings={() => navigate('settings', 'workspace')}
        />
        <label className="shell-header__profile" title={`Profile: ${selectedProfileLabel}`}>
          <span className="shell-header__profile-label">{selectedProfileLabel}</span>
          <IconChevronDown width={12} height={12} />
          <select
            aria-label="Profile"
            value={activeProfileId}
            onChange={(e) => switchProfile(e.target.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
