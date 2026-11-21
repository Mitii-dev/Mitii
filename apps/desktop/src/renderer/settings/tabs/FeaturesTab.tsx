/** Features tab: sub-tab nav and feature panels. */

import type { SettingsModel } from '../useSettingsPanelModel.js';
import { AutocompleteFeature } from '../features/AutocompleteFeature.js';
import { ReviewFeature } from '../features/ReviewFeature.js';
import { AgentFeature } from '../features/AgentFeature.js';
import { SearchFeature } from '../features/SearchFeature.js';
import { IndexFeature } from '../features/IndexFeature.js';

export function FeaturesTab({ m }: { m: SettingsModel }) {
  const {
    tab,
    featureTabs,
    featureTab,
    setFeatureTab,
  } = m;

  return tab === 'features' ? (
    <div className="settings-panel">
      <nav className="features-tabs" aria-label="Features">
        {featureTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`features-tab${featureTab === item.id ? ' is-active' : ''}`}
            aria-current={featureTab === item.id ? 'page' : undefined}
            onClick={() => setFeatureTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
  
      <div className="features-tab-panel">
        <AutocompleteFeature m={m} />
  
        <ReviewFeature m={m} />
  
        <AgentFeature m={m} />
  
        <SearchFeature m={m} />
  
        <IndexFeature m={m} />
      </div>
    </div>
  ) : null;
}
