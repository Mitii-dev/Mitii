import { KeyValueList } from './shared';
import { type TokenBudgetPreview } from '../../protocol';
import { TokenBudgetAllocation } from '@mitii/ui-react';

export function CustomerWindowBudgetSummary({
  preview,
}: {
  preview: TokenBudgetPreview;
}) {
  return (
    <div className="token-budget-preview">
      <p className="field-hint">
        These values follow the context window as you edit it. Use Developer →
        Token budget if you need sliders for files per mutation or module
        shares.
      </p>
      <TokenBudgetAllocation preview={preview} />
      <KeyValueList
        rows={[
          { label: 'Effective window', value: String(preview.contextWindowTokens) },
          { label: 'Usable input', value: String(preview.usableInputTokens) },
          { label: 'Output reserve', value: String(preview.maximumOutputTokens) },
          { label: 'Model-call cap', value: String(preview.maxModelCalls) },
          {
            label: 'Files per mutation',
            value: String(preview.maxUniqueFilesPerCall),
          },
          {
            label: 'Verification checks',
            value: String(preview.maxVerificationChecks),
          },
        ]}
      />
    </div>
  );
}

export function TokenBudgetPreviewTable({ preview }: { preview: TokenBudgetPreview }) {
  const rows: Array<[string, string]> = [
    ['Window', String(preview.contextWindowTokens)],
    ['Output reserve', String(preview.maximumOutputTokens)],
    ['Tool schemas', String(preview.toolSchemaTokens)],
    ['Usable input', String(preview.usableInputTokens)],
    ['Repository', String(preview.repositoryTokens)],
    ['Conversation', String(preview.conversationTokens)],
    ['Plan', String(preview.planTokens)],
    ['Skills', String(preview.skillsTokens)],
    ['Free (unallocated)', String(preview.systemTokens)],
    ['Model-call cap', String(preview.maxModelCalls)],
    ['Tool-call cap', String(preview.maxToolCalls)],
    ['Files per mutation', String(preview.maxUniqueFilesPerCall)],
    ['Patch payload chars', String(preview.maxPatchPayloadCharacters)],
    ['Recent tool results', String(preview.keepRecentToolResults)],
    ['Tool result content', `${preview.toolResultContentChars} chars`],
    ['Observation facts', String(preview.maxEstablishedFacts)],
    ['Verification checks', String(preview.maxVerificationChecks)],
    ['Visible plan', preview.visiblePlanAffordable ? 'affordable' : 'skipped'],
    [
      'Change impact',
      preview.changeImpactAffordable ? 'affordable' : 'skipped',
    ],
    [
      'Run budget (Modes)',
      preview.runBudgetUnlimited
        ? 'Unlimited'
        : `${preview.runBudgetMaxModelCalls} model / ${preview.runBudgetMaxToolCalls} tools`,
    ],
  ];
  return (
    <div className="token-budget-preview">
      <p className="field-hint">
        Derived split for the current window. Shares are of usable input
        (window − output − tools). Model and tool call limits are owned by
        Modes → Run budget.
      </p>
      <KeyValueList
        rows={rows.map(([label, value]) => ({ label, value }))}
      />
    </div>
  );
}
