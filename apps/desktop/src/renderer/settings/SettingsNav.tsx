/** Settings category nav (hidden when the activity bar owns categories). */

import { SETTINGS_TABS } from '../../shared/settings.js';
import type { SettingsModel } from './useSettingsPanelModel.js';

export function SettingsNav({ m }: { m: SettingsModel }) {
  const {
    props,
    tab,
    setTab,
  } = m;

  return props.hideSideNav ? null : (
    <nav className="settings-nav" aria-label="Settings">
      {SETTINGS_TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`settings-nav-item${tab === id ? ' is-active' : ''}`}
          aria-current={tab === id ? 'page' : undefined}
          onClick={() => setTab(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
