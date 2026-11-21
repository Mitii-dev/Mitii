import { AutocompleteTab } from './settings/AutocompleteTab';
import { ContextTab } from './settings/ContextTab';
import { DebugTab } from './settings/DebugTab';
import { FeaturesTab } from './settings/FeaturesTab';
import { IntegrationsTab } from './settings/IntegrationsTab';
import { ModelTab } from './settings/ModelTab';
import { ModesTab } from './settings/ModesTab';
import { NewProfileModal } from './settings/NewProfileModal';
import { SettingsFooter } from './settings/SettingsFooter';
import { WorkspaceTab } from './settings/WorkspaceTab';
import { NAV } from './settings/nav';
import { type SettingsPanelProps } from './settings/types';
import { useSettingsPanelState } from './settings/useSettingsPanelState';

export function SettingsPanel(props: SettingsPanelProps) {
  const view = useSettingsPanelState(props);
  const {
    onTabChange,
  } = props;

  const {
    activeTab,
    compact,
    hideIconTooltip,
    iconTooltip,
    page,
    rootRef,
    showIconTooltip,
  } = view;

  return (
    <div
      ref={rootRef}
      className={`settings-view${compact ? ' is-compact' : ''}`}
    >
      <nav className="settings-nav" aria-label="Settings">
        {NAV.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            className={`settings-nav__item${activeTab === id ? ' is-active' : ''}`}
            aria-current={activeTab === id ? 'page' : undefined}
            aria-label={label}
            title={compact ? label : undefined}
            onMouseEnter={(event) =>
              showIconTooltip(label, event.currentTarget)
            }
            onMouseLeave={hideIconTooltip}
            onFocus={(event) => showIconTooltip(label, event.currentTarget)}
            onBlur={hideIconTooltip}
            onClick={() => onTabChange(id)}
          >
            <span className="settings-nav__icon">{icon}</span>
            <span className="settings-nav__label">{label}</span>
          </button>
        ))}
      </nav>
      {compact && iconTooltip ? (
        <div
          className="settings-nav-tooltip"
          role="tooltip"
          style={{ top: iconTooltip.top }}
        >
          {iconTooltip.label}
        </div>
      ) : null}

      <div className="settings-main">
        <div className="settings-body">
          <header className="settings-page-header">
            <h2 className="settings-page-header__title">{page.title}</h2>
            <p className="settings-page-header__desc">{page.description}</p>
          </header>
          {activeTab === 'model' ? <ModelTab props={props} view={view} /> : null}
          {activeTab === 'autocomplete' ? <AutocompleteTab props={props} view={view} /> : null}
          {activeTab === 'workspace' ? <WorkspaceTab props={props} view={view} /> : null}
          {activeTab === 'modes' ? <ModesTab props={props} view={view} /> : null}
          {activeTab === 'context' ? <ContextTab props={props} view={view} /> : null}
          {activeTab === 'features' ? <FeaturesTab props={props} view={view} /> : null}
          {activeTab === 'integrations' ? <IntegrationsTab props={props} view={view} /> : null}
          {activeTab === 'debug' ? <DebugTab props={props} view={view} /> : null}
        </div>

        <SettingsFooter props={props} view={view} />
      </div>

      <NewProfileModal props={props} view={view} />
    </div>
  );
}
