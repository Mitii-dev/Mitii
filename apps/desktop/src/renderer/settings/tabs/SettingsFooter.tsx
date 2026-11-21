/** Save / reset footer. */

import { mergeDesktopSettings } from '../../../shared/settings.js';
import type { SettingsModel } from '../useSettingsPanelModel.js';

export function SettingsFooter({ m }: { m: SettingsModel }) {
  const {
    tab,
    saving,
    props,
    save,
    setDraft,
    setApiKey,
    setClearApiKey,
    setSearchApiKey,
    setClearSearchApiKey,
    setNote,
    note,
  } = m;

  return tab !== 'profiles' ? (
    <div className="settings-footer">
      <div className="settings-footer__actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || props.busy}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save & apply'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={saving}
          onClick={() => {
            const next = mergeDesktopSettings(props.settings);
            setDraft(next);
            setApiKey('');
            setClearApiKey(false);
            setSearchApiKey('');
            setClearSearchApiKey(false);
            setNote(null);
          }}
        >
          Reset draft
        </button>
      </div>
      {note ? (
        <p className="field-help settings-footer__note">{note}</p>
      ) : null}
    </div>
  ) : null;
}
