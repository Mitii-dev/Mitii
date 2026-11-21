/** Context tab: memories, checkpoints and budgets. */

import { MemoryPanel, CheckpointPanel } from '@mitii/ui-react';
import {
  addMemory,
  deleteMemory,
  clearMemories,
  restoreCheckpoint,
  deleteCheckpoint,
  clearCheckpoints,
} from '../../api.js';
import type { SettingsModel } from '../useSettingsPanelModel.js';
import { SettingsSection } from '../fields.js';

export function ContextTab({ m }: { m: SettingsModel }) {
  const {
    tab,
    draft,
    patch,
    contextNote,
    props,
    memories,
    contextBusy,
    setContextBusy,
    setContextNote,
    setMemories,
    checkpoints,
    setCheckpoints,
  } = m;

  return tab === 'context' ? (
    <div className="settings-panel">
      <SettingsSection
        title="Sources"
        description="Choose what evidence is attached to each turn."
      >
        {(
          [
            ['repoMap', 'Repository map'],
            ['diagnostics', 'Diagnostics'],
            ['gitDiff', 'Git diff'],
            ['editor', 'Active editor'],
            ['openTabs', 'Open tabs'],
            ['memory', 'Memory'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.ui.contextToggles[key]}
              onChange={(e) =>
                patch({
                  ui: {
                    ...draft.ui,
                    contextToggles: {
                      ...draft.ui.contextToggles,
                      [key]: e.target.checked,
                    },
                  },
                })
              }
            />
            {label}
          </label>
        ))}
      </SettingsSection>
  
      <SettingsSection
        title="Workspace memory & checkpoints"
        description="Durable preferences for this repo, plus labels after successful runs. Save settings to apply the Memory toggle to new runs."
      >
        {contextNote ? (
          <p className="field-help">{contextNote}</p>
        ) : null}
        {!props.engineBaseUrl ? (
          <p className="field-help">
            Engine is offline — memory and checkpoints need a running
            engine.
          </p>
        ) : (
          <div className="context-panels">
            <MemoryPanel
              className="context-side-panel"
              memories={memories}
              busy={contextBusy}
              onAdd={async (text) => {
                if (!props.engineBaseUrl) return;
                setContextBusy(true);
                setContextNote(null);
                try {
                  setMemories(
                    await addMemory({
                      baseUrl: props.engineBaseUrl,
                      token: props.authToken,
                      text,
                    }),
                  );
                } catch (err) {
                  setContextNote(
                    err instanceof Error ? err.message : String(err),
                  );
                } finally {
                  setContextBusy(false);
                }
              }}
              onDelete={async (id) => {
                if (!props.engineBaseUrl) return;
                setContextBusy(true);
                setContextNote(null);
                try {
                  setMemories(
                    await deleteMemory({
                      baseUrl: props.engineBaseUrl,
                      token: props.authToken,
                      id,
                    }),
                  );
                } catch (err) {
                  setContextNote(
                    err instanceof Error ? err.message : String(err),
                  );
                } finally {
                  setContextBusy(false);
                }
              }}
              onClear={async () => {
                if (!props.engineBaseUrl) return;
                setContextBusy(true);
                setContextNote(null);
                try {
                  await clearMemories({
                    baseUrl: props.engineBaseUrl,
                    token: props.authToken,
                  });
                  setMemories([]);
                } catch (err) {
                  setContextNote(
                    err instanceof Error ? err.message : String(err),
                  );
                } finally {
                  setContextBusy(false);
                }
              }}
            />
            <CheckpointPanel
              className="context-side-panel"
              emptyText="No checkpoints yet. Labels appear after successful agent runs."
              checkpoints={checkpoints}
              busy={contextBusy}
              onRestore={async (id) => {
                if (!props.engineBaseUrl) return;
                setContextBusy(true);
                try {
                  const result = await restoreCheckpoint({
                    baseUrl: props.engineBaseUrl,
                    token: props.authToken,
                    id,
                  });
                  setContextNote(result.message);
                } catch (err) {
                  setContextNote(
                    err instanceof Error ? err.message : String(err),
                  );
                } finally {
                  setContextBusy(false);
                }
              }}
              onDelete={async (id) => {
                if (!props.engineBaseUrl) return;
                setContextBusy(true);
                setContextNote(null);
                try {
                  setCheckpoints(
                    await deleteCheckpoint({
                      baseUrl: props.engineBaseUrl,
                      token: props.authToken,
                      id,
                    }),
                  );
                } catch (err) {
                  setContextNote(
                    err instanceof Error ? err.message : String(err),
                  );
                } finally {
                  setContextBusy(false);
                }
              }}
              onClear={async () => {
                if (!props.engineBaseUrl) return;
                setContextBusy(true);
                setContextNote(null);
                try {
                  await clearCheckpoints({
                    baseUrl: props.engineBaseUrl,
                    token: props.authToken,
                  });
                  setCheckpoints([]);
                } catch (err) {
                  setContextNote(
                    err instanceof Error ? err.message : String(err),
                  );
                } finally {
                  setContextBusy(false);
                }
              }}
            />
          </div>
        )}
      </SettingsSection>
    </div>
  ) : null;
}
