/** Settings page layout. */

import type { SettingsModel } from './useSettingsPanelModel.js';
import { ProfilesTab } from './tabs/ProfilesTab.js';
import { FeaturesTab } from './tabs/FeaturesTab.js';
import { WorkspacesTab } from './tabs/WorkspacesTab.js';
import { StorageTab } from './tabs/StorageTab.js';
import { ContextTab } from './tabs/ContextTab.js';
import { DebugTab } from './tabs/DebugTab.js';
import { SettingsFooter } from './tabs/SettingsFooter.js';
import { SettingsNav } from './SettingsNav.js';

export function SettingsView({ m }: { m: SettingsModel }) {
  const {
    props,
    page,
  } = m;

  return (
    <div
      className={`settings-view${props.hideSideNav ? ' settings-view--rail' : ''}`}
    >
      <SettingsNav m={m} />

      <div className="settings-main">
        <header className="settings-page-header">
          <h1>{page.title}</h1>
          <p>{page.description}</p>
        </header>

        <div className="settings-main__body">

        <ProfilesTab m={m} />

        <FeaturesTab m={m} />

        <WorkspacesTab m={m} />

        <StorageTab m={m} />

        <ContextTab m={m} />

        <DebugTab m={m} />

        </div>

        <SettingsFooter m={m} />
      </div>
    </div>
  );
}
