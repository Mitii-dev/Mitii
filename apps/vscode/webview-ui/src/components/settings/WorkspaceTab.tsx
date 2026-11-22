import { INDEX_CAPABILITY_LABELS, displayCapabilityStatus, formatIndexMode, capabilityDetails } from './indexLabels';
import { SettingsSection, KeyValueList } from './shared';
import { type SettingsPanelProps } from './types';
import { type SettingsPanelView } from './useSettingsPanelState';
import { type SemanticIndexSource } from '../../protocol';
import { NumberField } from '@mitii/ui-react';

export function WorkspaceTab({ props, view }: { props: SettingsPanelProps; view: SettingsPanelView }) {
  const {
    index,
    onClearOverride,
    onEmbeddingSourceChange,
    onMaximumIndexFilesChange,
    onOpenFolder,
    onOverrideDraftChange,
    onRefreshIndex,
    onReindex,
    overrideDraft,
    workspace,
  } = props;

  const {
    embeddingsDegraded,
  } = view;

  return (
    <div className="settings-panel">
      <SettingsSection
        title="Folder"
        description="Active folder used for indexing, context, and agent runs."
      >
        <div className="settings-path mono">
          {workspace.displayRoot ?? 'No folder open'}
        </div>
        <div className="row">
          <button
            type="button"
            className="btn ghost"
            onClick={onOpenFolder}
          >
            Open folder
          </button>
        </div>
        <details className="settings-advanced">
          <summary>Advanced</summary>
          <div className="field">
            <label htmlFor="override">Root path override</label>
            <input
              id="override"
              value={overrideDraft}
              placeholder={workspace.root ?? '/path/to/repo'}
              onChange={(e) => onOverrideDraftChange(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn ghost"
            onClick={onClearOverride}
          >
            Clear override
          </button>
        </details>
      </SettingsSection>

      <SettingsSection
        title="Repository index"
        description="Local file map used by Ask, Plan, Agent, and Review."
      >
        <div className="field">
          <label htmlFor="embedding-source">Embedding source</label>
          <select
            id="embedding-source"
            value={index.embeddingSource ?? 'bundled'}
            onChange={(e) =>
              onEmbeddingSourceChange(
                e.target.value as SemanticIndexSource,
              )
            }
          >
            <option value="bundled">
              Bundled MiniLM (on-device)
            </option>
            <option value="ollama">Ollama embeddings API</option>
            <option value="openai-compatible">
              OpenAI-compatible embeddings API
            </option>
            <option value="disabled">Disabled (lexical only)</option>
          </select>
          <p className="field-hint">
            {index.embeddingEnabled === false
              ? 'Semantic search is off. Reindex after enabling a source.'
              : index.embeddingSource === 'bundled'
                ? `On-device ${index.embeddingModel ?? 'all-MiniLM-L6-v2'} (384-d). Native ONNX when available, WASM otherwise. Reindex after changing source.`
                : index.embeddingSource === 'ollama'
                  ? `HTTP embeddings via Ollama (${index.embeddingModel ?? 'nomic-embed-text'}). Reindex after changing source.`
                  : index.embeddingSource === 'openai-compatible'
                    ? `HTTP embeddings via the OpenAI-compatible API (${index.embeddingModel ?? 'text-embedding-3-small'}). Reindex after changing source.`
                    : 'LanceDB stores vectors; it is not an embedding source.'}
          </p>
        </div>
        <NumberField
          id="maximum-index-files"
          label="Maximum index files"
          min={0}
          max={240000}
          value={index.maximumIndexFiles ?? 0}
          onCommit={onMaximumIndexFilesChange}
          hint="0 uses the default limit"
          footer={
            <p className="field-hint">
              0 uses the default limit. Reindex after changing this.
            </p>
          }
        />
        <KeyValueList
          rows={[
            { label: 'Indexed files', value: index.fileCount },
            { label: 'Files discovered in current scan', value: index.discoveredFileCount ?? '—' },
            { label: 'Stage', value: index.progressStage ?? '—' },
            { label: 'File limit reached', value: index.truncated ? 'Yes — scan is incomplete' : 'No' },
            { label: 'Last indexed', value: index.lastIndexedAt ?? '—' },
            { label: 'Readiness', value: index.readiness ?? '—' },
            { label: 'Scan', value: index.scanCompleteness ?? '—' },
            { label: 'Mode', value: formatIndexMode(index.indexMode) },
            {
              label: 'Pipeline health',
              value: index.pipelineHealth?.overall ?? '—',
            },
            {
              label: 'Code Index',
              value: index.pipelineHealth
                ? `${index.pipelineHealth.pipelines.codeIndex.status}${index.pipelineHealth.pipelines.codeIndex.reason ? ` (${index.pipelineHealth.pipelines.codeIndex.reason})` : ''}`
                : '—',
            },
            {
              label: 'Text FTS5',
              value: index.pipelineHealth
                ? `${index.pipelineHealth.pipelines.textFts.status}${index.pipelineHealth.pipelines.textFts.reason ? ` (${index.pipelineHealth.pipelines.textFts.reason})` : ''}`
                : '—',
            },
            {
              label: 'Embeddings',
              value: index.pipelineHealth
                ? `${index.pipelineHealth.pipelines.embeddings.status}${index.pipelineHealth.pipelines.embeddings.reason ? ` (${index.pipelineHealth.pipelines.embeddings.reason})` : ''}`
                : '—',
            },
            {
              label: 'Native modules',
              value: index.pipelineHealth
                ? `sqlite=${index.pipelineHealth.native.sqlite} · lancedb=${index.pipelineHealth.native.lancedb} · onnx=${index.pipelineHealth.native.onnx}`
                : '—',
            },
          ]}
        />
        {capabilityDetails(index).length > 0 ? (
          <div
            className="index-capability-list"
            aria-label="Repository index capability status"
          >
            {capabilityDetails(index).map((capability) => {
              const label =
                INDEX_CAPABILITY_LABELS[capability.capability] ??
                capability.capability;
              const displayStatus = displayCapabilityStatus(capability);
              return (
                <div
                  key={`${capability.rootId ?? 'root'}:${capability.capability}`}
                  className={`index-capability index-capability--${displayStatus.className}`}
                  title={[
                    capability.rootId
                      ? `Root: ${capability.rootId}`
                      : undefined,
                    capability.revision
                      ? `Revision: ${capability.revision}`
                      : undefined,
                    capability.profile
                      ? `Profile: ${capability.profile}`
                      : undefined,
                    capability.reasonCode
                      ? `Reason: ${capability.reasonCode}`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <span className="index-capability__name">{label}</span>
                  <span className="index-capability__status">
                    {displayStatus.label}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        <p className="field-hint">
          {index.message ?? 'No index yet'}
          {index.truncated ? ' · truncated' : ''}
          {embeddingsDegraded
            ? ' · Semantic search is degraded. Reindex to rebuild embeddings.'
            : ''}
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={onReindex}>
            {embeddingsDegraded ? 'Reindex embeddings' : 'Reindex'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={onRefreshIndex}
          >
            Refresh
          </button>
        </div>
      </SettingsSection>
    </div>
  );
}
