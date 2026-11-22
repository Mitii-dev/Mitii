import { type CSSProperties } from 'react';
import { type AppApi } from '../app/appApi';
import { postToHost } from '../bridge';
import { ComposerControls } from '../components/ComposerControls';
import { IconButton } from '../components/IconButton';
import { IconCopy, IconCheck, IconModel, IconSend, IconSlash, IconStop, IconTokens } from '../components/Icons';
import { inferThoroughness } from '@mitii/ui-core';
import { ModelQuickSelect, TokenMeter } from '@mitii/ui-react';

export function ComposerFooter({ api }: { api: AppApi }) {
  const {
    approvalMode,
    changeApprovalMode,
    changeMode,
    changeThoroughness,
    costRates,
    currentModeColor,
    depth,
    effort,
    mode,
    modelOptions,
    openSkillPicker,
    pinnedSkillIds,
    prompt,
    provider,
    providerRef,
    running,
    saveModel,
    selectedModelIsCustom,
    selectedModelLabel,
    send,
    setCustomModel,
    suggestKind,
    suggestOpen,
    thoroughness,
    tokenUsage,
    ui,
    updateProvider,
  } = api;

  return (
    <div className="composer-footer">
      <div className="composer-controls-row">
        <ComposerControls
          mode={mode}
          approvalMode={approvalMode}
          thoroughness={thoroughness}
          intensityCustom={
            ui.intensityOverrides === true &&
            inferThoroughness(depth, effort) === undefined
          }
          onModeChange={changeMode}
          onApprovalModeChange={changeApprovalMode}
          onThoroughnessChange={changeThoroughness}
        />
        <div className="composer-actions">
          <IconButton
            label="Attach skill"
            variant="ghost"
            className="icon-btn--slash"
            active={suggestOpen && suggestKind === 'skill'}
            disabled={pinnedSkillIds.length >= 3}
            onClick={openSkillPicker}
          >
            <IconSlash />
          </IconButton>
          <IconButton
            label="Copy last response"
            onClick={() =>
              postToHost({ type: 'copyLastResponse' })
            }
          >
            <IconCopy />
          </IconButton>
          {running ? (
            <IconButton
              label="Stop"
              className="icon-btn--danger"
              onClick={() => postToHost({ type: 'cancel' })}
            >
              <IconStop />
            </IconButton>
          ) : (
            <IconButton
              label="Send"
              className="icon-btn--mode"
              style={
                {
                  '--composer-control-color': currentModeColor,
                } as CSSProperties
              }
              onClick={send}
              disabled={!prompt.trim()}
            >
              <IconSend />
            </IconButton>
          )}
        </div>
      </div>
      <div className="composer-meta-row">
        <TokenMeter
          usage={tokenUsage}
          placement="above"
          glyph={<IconTokens width={14} height={14} />}
          costRates={costRates}
        />
        <ModelQuickSelect
          label={selectedModelLabel}
          model={provider.model}
          models={modelOptions}
          triggerIcon={<IconModel />}
          checkIcon={<IconCheck />}
          showCaret={false}
          filterThreshold={Number.POSITIVE_INFINITY}
          onChange={(model) => {
            setCustomModel(false);
            saveModel(model);
          }}
          custom={{
            active: selectedModelIsCustom,
            onSelect: () => setCustomModel(true),
            onDraftChange: (model) =>
              updateProvider((p) => ({ ...p, model })),
            onCommit: () => {
              const model = providerRef.current.model.trim();
              if (model) saveModel(model);
            },
          }}
        />
      </div>
    </div>
  );
}
