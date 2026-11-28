/** Semantic index, Ollama embedding model and index controls. */

import { type DesktopSettings } from '../../../shared/settings.js';
import { getDesktopBridge, reindexWorkspace } from '../../api.js';
import type { SettingsModel } from '../useSettingsPanelModel.js';
import { SettingsSection, Field } from '../fields.js';
import { NOMIC_EMBED_MODEL, OLLAMA_INSTALL_URL } from '../nomicEmbed.js';
import { MaximumIndexFilesField } from '../MaximumIndexFilesField.js';

export function IndexFeature({ m }: { m: SettingsModel }) {
  const {
    featureTab,
    indexMessage,
    draft,
    patch,
    nomicNote,
    nomicStatus,
    nomicProgress,
    useNomicNow,
    props,
    downloadNomic,
    reindexing,
    setReindexing,
    setIndexMessage,
    ollamaEmbeddingBaseUrl,
  } = m;

  return featureTab === 'index' ? (
    <SettingsSection
      title="Workspace index"
      description="FTS + symbols (lexical) always run and keep the project searchable. Semantic vectors are optional — enable below to add MiniLM or an HTTP embedding model; the header chip then shows progress and a rough time estimate."
    >
      <p className="field-help">{indexMessage}</p>
  
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.semanticIndex.enabled}
          onChange={(e) =>
            patch({
              semanticIndex: {
                ...draft.semanticIndex,
                enabled: e.target.checked,
                ...(e.target.checked
                  ? draft.semanticIndex.source === 'disabled'
                    ? {
                        source: 'bundled' as const,
                        backend: 'bundled' as const,
                      }
                    : {}
                  : {
                      source: 'disabled' as const,
                      backend: 'disabled' as const,
                    }),
              },
            })
          }
        />
        Enable semantic (vector) indexing
      </label>
      <p className="field-help">
        On by default with Bundled MiniLM. Embeddings run after
        FTS/symbols (or use Ollama / OpenAI-compatible). Expect
        roughly 1–3 minutes per 1k files for MiniLM; HTTP sources
        are slower. Turn off to keep lexical search only.
      </p>
  
      {draft.semanticIndex.enabled ? (
        <div className="field-grid">
          <Field
            id="embSource"
            label="Embedding source"
            full
            hint="Bundled MiniLM runs on-device. HTTP sources need a reachable embeddings API."
          >
            <select
              id="embSource"
              value={
                draft.semanticIndex.source === 'disabled'
                  ? 'bundled'
                  : draft.semanticIndex.source
              }
              onChange={(e) => {
                const source = e.target
                  .value as DesktopSettings['semanticIndex']['source'];
                patch({
                  semanticIndex: {
                    ...draft.semanticIndex,
                    source,
                    backend:
                      source === 'bundled'
                        ? 'bundled'
                        : source === 'ollama'
                          ? 'ollama'
                          : source === 'openai-compatible'
                            ? 'openai-compatible'
                            : 'auto',
                  },
                });
              }}
            >
              <option value="bundled">Bundled MiniLM</option>
              <option value="ollama">Ollama</option>
              <option value="openai-compatible">
                OpenAI-compatible
              </option>
            </select>
          </Field>
  
          {draft.semanticIndex.source === 'bundled' ? (
            <p className="field-help field full">
              Uses on-device MiniLM. Model URL and dimensions are not
              required.
            </p>
          ) : null}
  
          <div className="embedding-upgrade field full">
            <div className="embedding-upgrade__copy">
              <p className="embedding-upgrade__title">
                Better accuracy (optional)
              </p>
              <p className="embedding-upgrade__body">
                Download Nomic Embed Text for stronger semantic
                search. ~274 MB via Ollama — not shipped with Mitii.
                Bundled MiniLM still works without this.
              </p>
              {nomicNote ? (
                <p className="field-help">{nomicNote}</p>
              ) : null}
              {nomicStatus === 'downloading' &&
              nomicProgress !== undefined ? (
                <div
                  className="embedding-upgrade__bar"
                  role="progressbar"
                  aria-valuenow={nomicProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${nomicProgress}%` }} />
                </div>
              ) : null}
            </div>
            <div className="embedding-upgrade__actions">
              {nomicStatus === 'ready' ? (
                <>
                  <span className="embedding-upgrade__badge">
                    Ready
                  </span>
                  {draft.semanticIndex.source !== 'ollama' ||
                  draft.semanticIndex.model.trim() !==
                    NOMIC_EMBED_MODEL ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={useNomicNow}
                    >
                      Use Nomic
                    </button>
                  ) : null}
                </>
              ) : null}
              {nomicStatus === 'checking' ? (
                <span className="embedding-upgrade__badge">
                  Checking…
                </span>
              ) : null}
              {nomicStatus === 'downloading' ? (
                <span className="embedding-upgrade__badge">
                  {nomicProgress !== undefined
                    ? `${nomicProgress}%`
                    : 'Downloading…'}
                </span>
              ) : null}
              {nomicStatus === 'missing' ||
              nomicStatus === 'unreachable' ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!props.engineBaseUrl}
                    onClick={() => void downloadNomic()}
                  >
                    Download
                  </button>
                  {nomicStatus === 'unreachable' ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        void getDesktopBridge()?.openExternal(
                          OLLAMA_INSTALL_URL,
                        );
                      }}
                    >
                      Install Ollama
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
  
          {draft.semanticIndex.source === 'ollama' ||
          draft.semanticIndex.source === 'openai-compatible' ? (
            <>
              <Field
                id="embModel"
                label="Embedding model"
                full
                hint={
                  draft.semanticIndex.source === 'ollama'
                    ? 'Empty defaults to nomic-embed-text'
                    : 'Required for most OpenAI-compatible hosts'
                }
              >
                <input
                  id="embModel"
                  value={draft.semanticIndex.model}
                  placeholder={
                    draft.semanticIndex.source === 'ollama'
                      ? 'nomic-embed-text'
                      : 'text-embedding-3-small'
                  }
                  onChange={(e) =>
                    patch({
                      semanticIndex: {
                        ...draft.semanticIndex,
                        model: e.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field
                id="embDim"
                label="Dimensions"
                hint="0 = model / probe default"
              >
                <input
                  id="embDim"
                  type="number"
                  min={0}
                  value={draft.semanticIndex.dimensions}
                  onChange={(e) =>
                    patch({
                      semanticIndex: {
                        ...draft.semanticIndex,
                        dimensions: Number(e.target.value) || 0,
                      },
                    })
                  }
                />
              </Field>
              <label className="checkbox-row field full">
                <input
                  type="checkbox"
                  checked={draft.semanticIndex.normalized}
                  onChange={(e) =>
                    patch({
                      semanticIndex: {
                        ...draft.semanticIndex,
                        normalized: e.target.checked,
                      },
                    })
                  }
                />
                Normalize embedding vectors
              </label>
            </>
          ) : null}
  
          <MaximumIndexFilesField
            id="maxFiles"
            value={draft.workspace.maximumIndexFiles}
            onChange={(maximumIndexFiles) =>
              patch({
                workspace: {
                  ...draft.workspace,
                  maximumIndexFiles,
                },
              })
            }
          />
        </div>
      ) : (
        <div className="field-grid">
          <p className="field-help field full">
            Semantic search is off. You can still build a lexical
            index for this repo.
          </p>
          <MaximumIndexFilesField
            id="maxFilesOff"
            value={draft.workspace.maximumIndexFiles}
            onChange={(maximumIndexFiles) =>
              patch({
                workspace: {
                  ...draft.workspace,
                  maximumIndexFiles,
                },
              })
            }
          />
        </div>
      )}
  
      <div className="settings-actions">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={reindexing || !props.engineBaseUrl}
          title="Fingerprint-aware refresh (no full rebuild)"
          onClick={() => {
            if (!props.engineBaseUrl) return;
            setReindexing(true);
            setIndexMessage('Refreshing index…');
            props.onIndexStarted?.();
            void reindexWorkspace({
              baseUrl: props.engineBaseUrl,
              token: props.authToken,
              force: false,
              maximumFiles:
                draft.workspace.maximumIndexFiles || undefined,
              semanticIndex: {
                enabled: draft.semanticIndex.enabled,
                source: draft.semanticIndex.source,
                model:
                  draft.semanticIndex.model.trim() ||
                  (draft.semanticIndex.source === 'ollama'
                    ? NOMIC_EMBED_MODEL
                    : ''),
                dimensions: draft.semanticIndex.dimensions,
                normalized: draft.semanticIndex.normalized,
                baseUrl:
                  draft.semanticIndex.source === 'ollama'
                    ? ollamaEmbeddingBaseUrl
                    : draft.provider.baseUrl,
              },
            })
              .then((result) => {
                setIndexMessage(result.message);
                if (result.statusSnapshot) {
                  setIndexMessage(result.statusSnapshot.message);
                }
                props.onIndexChanged?.();
              })
              .catch((err: unknown) => {
                setIndexMessage(
                  err instanceof Error ? err.message : String(err),
                );
                props.onIndexChanged?.();
              })
              .finally(() => setReindexing(false));
          }}
        >
          {reindexing ? 'Indexing…' : 'Refresh index'}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={reindexing || !props.engineBaseUrl}
          title="Force a full rebuild of the workspace index"
          onClick={() => {
            if (!props.engineBaseUrl) return;
            setReindexing(true);
            setIndexMessage('Rebuilding index…');
            props.onIndexStarted?.();
            void reindexWorkspace({
              baseUrl: props.engineBaseUrl,
              token: props.authToken,
              force: true,
              maximumFiles:
                draft.workspace.maximumIndexFiles || undefined,
              semanticIndex: {
                enabled: draft.semanticIndex.enabled,
                source: draft.semanticIndex.source,
                model:
                  draft.semanticIndex.model.trim() ||
                  (draft.semanticIndex.source === 'ollama'
                    ? NOMIC_EMBED_MODEL
                    : ''),
                dimensions: draft.semanticIndex.dimensions,
                normalized: draft.semanticIndex.normalized,
                baseUrl:
                  draft.semanticIndex.source === 'ollama'
                    ? ollamaEmbeddingBaseUrl
                    : draft.provider.baseUrl,
              },
            })
              .then((result) => {
                setIndexMessage(result.message);
                if (result.statusSnapshot) {
                  setIndexMessage(result.statusSnapshot.message);
                }
                props.onIndexChanged?.();
              })
              .catch((err: unknown) => {
                setIndexMessage(
                  err instanceof Error ? err.message : String(err),
                );
                props.onIndexChanged?.();
              })
              .finally(() => setReindexing(false));
          }}
        >
          {reindexing ? 'Indexing…' : 'Rebuild index'}
        </button>
      </div>
    </SettingsSection>
  ) : null;
}
