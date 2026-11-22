/** Storage tab: paths, cache and logs. */

import { getDesktopBridge } from '../../api.js';
import type { SettingsModel } from '../useSettingsPanelModel.js';
import { SettingsSection } from '../fields.js';

export function StorageTab({ m }: { m: SettingsModel }) {
  const {
    tab,
    storage,
    storageBusy,
    setStorageBusy,
    setStorageNote,
    refreshStorage,
    props,
    storageNote,
  } = m;

  return tab === 'storage' ? (
    <div className="settings-panel">
      <SettingsSection
        title="Storage"
        description="Set a root folder once. Each project stores index, memory, skills, and chat history under Root/projects/<name>--<id>/, and the repo’s .mitii becomes a link."
      >
        <div className="storage-paths">
          <div className="storage-path-row">
            <div className="storage-path-row__meta">
              <strong>Root storage</strong>
              <span className="field-help">
                Parent for all projects
                {storage?.rootStorageCustom
                  ? ' · active'
                  : ' · not set (data stays inside each repo’s .mitii)'}
              </span>
              <code className="storage-path-row__path">
                {storage?.rootStoragePath ||
                  storage?.rootStorageDefaultPath ||
                  '…'}
              </code>
              {storage?.rootStorageCustom ? (
                <span className="field-help">
                  Layout:{' '}
                  <code>
                    {`${storage.rootStoragePath || 'Root'}/projects/<project>--<id>/`}
                  </code>
                </span>
              ) : null}
            </div>
            <div className="storage-path-row__actions">
              <button
                type="button"
                className="btn-ghost"
                disabled={!storage || storageBusy}
                onClick={() => {
                  const bridge = getDesktopBridge();
                  if (!storage || !bridge?.revealInFolder) return;
                  const p =
                    storage.rootStoragePath ||
                    storage.rootStorageDefaultPath;
                  void bridge.revealInFolder(p);
                }}
              >
                Reveal
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={storageBusy}
                onClick={() => {
                  const bridge = getDesktopBridge();
                  if (!bridge?.pickDirectory || !bridge.setRootStorageLocation)
                    return;
                  setStorageBusy(true);
                  setStorageNote(null);
                  void bridge
                    .pickDirectory()
                    .then(async (picked) => {
                      if (!picked.ok || !picked.path) return;
                      const result = await bridge.setRootStorageLocation(
                        picked.path,
                      );
                      if (!result.ok) {
                        setStorageNote(result.reason ?? 'failed');
                        return;
                      }
                      setStorageNote(
                        'Root storage set. Projects live under projects/<name>--<id>/.',
                      );
                      await refreshStorage();
                    })
                    .finally(() => setStorageBusy(false));
                }}
              >
                Choose…
              </button>
              {!storage?.rootStorageCustom ? (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={storageBusy || !storage}
                  onClick={() => {
                    const bridge = getDesktopBridge();
                    if (!bridge?.setRootStorageLocation || !storage)
                      return;
                    setStorageBusy(true);
                    setStorageNote(null);
                    void bridge
                      .setRootStorageLocation(
                        storage.rootStorageDefaultPath,
                      )
                      .then(async (result) => {
                        if (!result.ok) {
                          setStorageNote(result.reason ?? 'failed');
                          return;
                        }
                        setStorageNote(
                          'Using recommended root. Active project linked under projects/.',
                        );
                        await refreshStorage();
                      })
                      .finally(() => setStorageBusy(false));
                  }}
                >
                  Use recommended
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={storageBusy}
                  onClick={() => {
                    const bridge = getDesktopBridge();
                    if (!bridge?.setRootStorageLocation) return;
                    setStorageBusy(true);
                    void bridge
                      .setRootStorageLocation(null)
                      .then(async (result) => {
                        if (!result.ok) {
                          setStorageNote(result.reason ?? 'failed');
                          return;
                        }
                        setStorageNote(
                          'Root storage cleared (legacy in-repo mode).',
                        );
                        await refreshStorage();
                      })
                      .finally(() => setStorageBusy(false));
                  }}
                >
                  Clear root
                </button>
              )}
            </div>
          </div>
  
          <div className="storage-path-row">
            <div className="storage-path-row__meta">
              <strong>App data</strong>
              <span className="field-help">
                Settings database, secrets
                {storage?.appDataCustom ? ' · custom' : ' · default'}
              </span>
              <code className="storage-path-row__path">
                {storage?.appDataPath ?? '…'}
              </code>
            </div>
            <div className="storage-path-row__actions">
              <button
                type="button"
                className="btn-ghost"
                disabled={!storage || storageBusy}
                onClick={() => {
                  const bridge = getDesktopBridge();
                  if (!storage || !bridge?.revealInFolder) return;
                  void bridge.revealInFolder(storage.appDataPath);
                }}
              >
                Reveal
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={storageBusy}
                onClick={() => {
                  const bridge = getDesktopBridge();
                  if (!bridge?.pickDirectory || !bridge.setAppDataLocation)
                    return;
                  setStorageBusy(true);
                  setStorageNote(null);
                  void bridge
                    .pickDirectory()
                    .then(async (picked) => {
                      if (!picked.ok || !picked.path) return;
                      const result = await bridge.setAppDataLocation(
                        picked.path,
                      );
                      if (!result.ok) {
                        setStorageNote(result.reason ?? 'failed');
                        return;
                      }
                      setStorageNote(
                        'App data location saved. Restart Mitii Desktop to apply.',
                      );
                      await refreshStorage();
                    })
                    .finally(() => setStorageBusy(false));
                }}
              >
                Choose…
              </button>
              {storage?.appDataCustom ? (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={storageBusy}
                  onClick={() => {
                    const bridge = getDesktopBridge();
                    if (!bridge?.setAppDataLocation) return;
                    setStorageBusy(true);
                    void bridge
                      .setAppDataLocation(null)
                      .then(async (result) => {
                        if (!result.ok) {
                          setStorageNote(result.reason ?? 'failed');
                          return;
                        }
                        setStorageNote(
                          'Reset to default app data. Restart Mitii Desktop to apply.',
                        );
                        await refreshStorage();
                      })
                      .finally(() => setStorageBusy(false));
                  }}
                >
                  Use default
                </button>
              ) : null}
            </div>
          </div>
  
          <div className="storage-path-row">
            <div className="storage-path-row__meta">
              <strong>
                {storage?.usesRootStorage
                  ? `Project · ${storage.projectSlug || 'current'}`
                  : 'Workspace data (.mitii)'}
              </strong>
              <span className="field-help">
                Index, memory, skills, chat history
                {storage?.usesRootStorage
                  ? ` · under Root/projects/${storage.projectFolderName || '…'}`
                  : storage?.workspaceDataIsLink
                    ? ' · custom link'
                    : ' · in-repo (set Root storage to move out)'}
              </span>
              <code className="storage-path-row__path">
                {storage?.workspaceDataTarget ?? '…'}
              </code>
              {storage?.usesRootStorage ? (
                <span className="field-help">
                  Repo link: <code>{storage.workspaceDataPath}</code>
                </span>
              ) : null}
            </div>
            <div className="storage-path-row__actions">
              <button
                type="button"
                className="btn-ghost"
                disabled={!storage || storageBusy}
                onClick={() => {
                  const bridge = getDesktopBridge();
                  if (!storage || !bridge?.revealInFolder) return;
                  void bridge.revealInFolder(storage.workspaceDataTarget);
                }}
              >
                Reveal
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={storageBusy || !props.workspaceRoot}
                onClick={() => {
                  const bridge = getDesktopBridge();
                  if (
                    !bridge?.pickDirectory ||
                    !bridge.setWorkspaceDataLocation
                  )
                    return;
                  const ok = window.confirm(
                    'Override this project’s data folder?\n\nExisting files are moved and .mitii becomes a link to the new location.',
                  );
                  if (!ok) return;
                  setStorageBusy(true);
                  setStorageNote(null);
                  void bridge
                    .pickDirectory()
                    .then(async (picked) => {
                      if (!picked.ok || !picked.path) return;
                      const result =
                        await bridge.setWorkspaceDataLocation(
                          picked.path,
                        );
                      if (!result.ok) {
                        setStorageNote(result.reason ?? 'failed');
                        return;
                      }
                      setStorageNote(
                        `Project data now at ${result.target ?? picked.path}`,
                      );
                      await refreshStorage();
                    })
                    .finally(() => setStorageBusy(false));
                }}
              >
                Choose…
              </button>
              {storage?.workspaceDataIsLink ? (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={storageBusy}
                  onClick={() => {
                    const bridge = getDesktopBridge();
                    if (!bridge?.setWorkspaceDataLocation) return;
                    setStorageBusy(true);
                    void bridge
                      .setWorkspaceDataLocation(null)
                      .then(async (result) => {
                        if (!result.ok) {
                          setStorageNote(result.reason ?? 'failed');
                          return;
                        }
                        setStorageNote(
                          storage?.usesRootStorage
                            ? 'Restored link to Root/projects/<name>/.'
                            : 'Workspace data restored under <repo>/.mitii',
                        );
                        await refreshStorage();
                      })
                      .finally(() => setStorageBusy(false));
                  }}
                >
                  Reset link
                </button>
              ) : null}
            </div>
          </div>
  
          <div className="storage-path-row">
            <div className="storage-path-row__meta">
              <strong>Logs</strong>
              <span className="field-help">
                Chat session JSONL (same as VS Code):{' '}
                <code>MM-DD-YYYY-HH-MM-thread_….jsonl</code>. Also{' '}
                <code>engine.log</code> / <code>runs.log</code>, plus
                dated product errors in{' '}
                <code>desktop-YYYY-MM-DD.log</code> (settings, SQLite,
                indexing, boot).
              </span>
              <code className="storage-path-row__path">
                {storage?.logsPath ?? '…'}
              </code>
            </div>
            <div className="storage-path-row__actions">
              <button
                type="button"
                className="btn-ghost"
                disabled={!storage || storageBusy}
                onClick={() => {
                  const bridge = getDesktopBridge();
                  if (!storage || !bridge?.revealInFolder) return;
                  void bridge.revealInFolder(storage.logsPath);
                }}
              >
                Reveal
              </button>
            </div>
          </div>
        </div>
        {storageNote ? (
          <p className="field-help storage-note">{storageNote}</p>
        ) : null}
      </SettingsSection>
  
    </div>
  ) : null;
}
