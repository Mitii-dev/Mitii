import type {
  TokenBudgetFieldDescriptor,
  TokenBudgetPreview,
} from '../protocol';
import { IconHelpCircle } from './Icons';

const TOKEN_BUDGET_DOCS_BASE =
  'https://example.com/mitii/docs/window-budget';
const TOKEN_BUDGET_SMALL_WINDOW = 30_000;
const TOKEN_BUDGET_LARGE_WINDOW = 300_000;

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.floor(value)));
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 4,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${formatDecimal(value * 100)}%`;
}

function fieldDocsHref(field: TokenBudgetFieldDescriptor): string {
  return (
    field.docsHref ??
    `${TOKEN_BUDGET_DOCS_BASE}#${encodeURIComponent(field.key)}`
  );
}

function ratioBase(
  fieldKey: string,
  preview: TokenBudgetPreview,
): { label: string; value: number } | null {
  if (
    fieldKey === 'outputRatio' ||
    fieldKey === 'outputWindowCapRatio' ||
    fieldKey === 'toolSchemaFallbackWindowRatio' ||
    fieldKey === 'visiblePlanMinUsableRatio' ||
    fieldKey === 'changeImpactMinUsableRatio'
  ) {
    return { label: 'context window', value: preview.contextWindowTokens };
  }
  if (
    fieldKey === 'compactionWarnRatio' ||
    fieldKey === 'compactionAutoRatio' ||
    fieldKey === 'compactionHardRatio'
  ) {
    return { label: 'loop budget', value: preview.loopInputBudgetTokens };
  }
  if (fieldKey === 'patchPayloadOutputRatio') {
    return { label: 'output reserve', value: preview.maximumOutputTokens };
  }
  if (
    fieldKey === 'loopSafetyRatio' ||
    fieldKey === 'repositoryShare' ||
    fieldKey === 'conversationShare' ||
    fieldKey === 'planShare' ||
    fieldKey === 'skillsShare' ||
    fieldKey.endsWith('CharsRatio') ||
    fieldKey.endsWith('CountRatio')
  ) {
    return { label: 'usable input', value: preview.usableInputTokens };
  }
  return null;
}

function scaledRatioExample(
  value: number,
  base: { label: string; value: number },
  preview: TokenBudgetPreview,
): string {
  const usableFraction =
    preview.contextWindowTokens > 0
      ? preview.usableInputTokens / preview.contextWindowTokens
      : 0;
  const loopFraction =
    preview.contextWindowTokens > 0
      ? preview.loopInputBudgetTokens / preview.contextWindowTokens
      : 0;
  const outputFraction =
    preview.contextWindowTokens > 0
      ? preview.maximumOutputTokens / preview.contextWindowTokens
      : 0;
  const baseForWindow = (windowTokens: number): number => {
    if (base.label === 'usable input') return windowTokens * usableFraction;
    if (base.label === 'loop budget') return windowTokens * loopFraction;
    if (base.label === 'output reserve') return windowTokens * outputFraction;
    return windowTokens;
  };
  const small = Math.floor(baseForWindow(TOKEN_BUDGET_SMALL_WINDOW) * value);
  const large = Math.floor(baseForWindow(TOKEN_BUDGET_LARGE_WINDOW) * value);
  return `Approx ${formatCount(small)} at ${formatCount(
    TOKEN_BUDGET_SMALL_WINDOW,
  )} window, ${formatCount(large)} at ${formatCount(
    TOKEN_BUDGET_LARGE_WINDOW,
  )} before min/max clamps.`;
}

function appliedTokenBudgetEffect(
  fieldKey: string,
  preview: TokenBudgetPreview,
): string {
  switch (fieldKey) {
    case 'outputRatio':
    case 'outputMinTokens':
    case 'outputMaxTokens':
    case 'outputWindowCapRatio':
      return `Current output reserve is ${formatCount(
        preview.maximumOutputTokens,
      )} tokens.`;
    case 'toolSchemaFallbackTokens':
    case 'toolSchemaFallbackWindowRatio':
      return `Current tool-schema reserve is ${formatCount(
        preview.toolSchemaTokens,
      )} tokens.`;
    case 'minimumUsableInputTokens':
      return `Current usable input is ${formatCount(
        preview.usableInputTokens,
      )} tokens.`;
    case 'loopSafetyRatio':
      return `Current live loop budget is ${formatCount(
        preview.loopInputBudgetTokens,
      )} tokens.`;
    case 'repositoryShare':
    case 'repositoryTokensCap':
      return `Repository context currently gets ${formatCount(
        preview.repositoryTokens,
      )} tokens.`;
    case 'conversationShare':
      return `Conversation and tool history currently get ${formatCount(
        preview.conversationTokens,
      )} tokens.`;
    case 'planShare':
    case 'planTokensCap':
      return `Plan text currently gets ${formatCount(preview.planTokens)} tokens.`;
    case 'skillsShare':
    case 'skillsTokensCap':
      return `Skill bodies currently get ${formatCount(
        preview.skillsTokens,
      )} tokens and up to ${formatCount(preview.maxSkills)} skills.`;
    case 'compactionWarnRatio':
      return `Compaction warning starts near ${formatCount(
        preview.compactionWarnTokens,
      )} loop tokens.`;
    case 'compactionAutoRatio':
      return `Auto compaction starts near ${formatCount(
        preview.compactionAutoTokens,
      )} loop tokens.`;
    case 'compactionHardRatio':
      return `Hard compaction starts near ${formatCount(
        preview.compactionHardTokens,
      )} loop tokens.`;
    case 'keepRecentToolResultsRatio':
    case 'keepRecentToolResultsMin':
    case 'keepRecentToolResultsMax':
      return `Keeps ${formatCount(
        preview.keepRecentToolResults,
      )} recent tool results in full.`;
    case 'compactedToolResultCharsRatio':
    case 'compactedToolResultCharsMin':
    case 'compactedToolResultCharsMax':
      return `Older tool results compact to ${formatCount(
        preview.compactedToolResultChars,
      )} chars each.`;
    case 'compactedToolArgumentCharsRatio':
    case 'compactedToolArgumentCharsMin':
    case 'compactedToolArgumentCharsMax':
      return `Old tool-call arguments compact to ${formatCount(
        preview.compactedToolArgumentChars,
      )} chars each.`;
    case 'toolResultContentCharsRatio':
    case 'toolResultContentCharsMin':
    case 'toolResultContentCharsMax':
      return `Serialized tool content sent to the model is capped at ${formatCount(
        preview.toolResultContentChars,
      )} chars.`;
    case 'droppedTurnSummaryCharsRatio':
    case 'droppedTurnSummaryCharsMin':
    case 'droppedTurnSummaryCharsMax':
      return `Dropped-turn summaries can use ${formatCount(
        preview.droppedTurnSummaryChars,
      )} chars.`;
    case 'establishedFactCharsRatio':
    case 'establishedFactCharsMin':
    case 'establishedFactCharsMax':
      return `Each retained observation can use ${formatCount(
        preview.establishedFactChars,
      )} chars.`;
    case 'establishedFactCountRatio':
    case 'establishedFactCountMin':
    case 'establishedFactCountMax':
      return `Keeps up to ${formatCount(
        preview.maxEstablishedFacts,
      )} established observations.`;
    case 'establishedFactReinjectCharsRatio':
    case 'establishedFactReinjectCharsMin':
    case 'establishedFactReinjectCharsMax':
      return `Observation reinjection can use ${formatCount(
        preview.establishedFactReinjectChars,
      )} chars.`;
    case 'memoryReinjectCharsRatio':
    case 'memoryReinjectCharsMin':
    case 'memoryReinjectCharsMax':
      return `Memory reinjection can use ${formatCount(
        preview.memoryReinjectChars,
      )} chars.`;
    case 'filesPerOutputTokens':
    case 'minUniqueFilesPerCall':
    case 'maxUniqueFilesPerCallCap':
      return `Each mutation call can touch ${formatCount(
        preview.maxUniqueFilesPerCall,
      )} files and ${formatCount(preview.maxPatchesPerCall)} patches.`;
    case 'patchPayloadOutputRatio':
    case 'charsPerOutputToken':
      return `Patch payload budget is ${formatCount(
        preview.maxPatchPayloadCharacters,
      )} chars.`;
    case 'requireBatchedBelowOutputTokens':
      return preview.requireBatchedExecution
        ? 'Batched mutation is currently required for this output reserve.'
        : 'Batched mutation is currently optional for this output reserve.';
    case 'visiblePlanMinUsableTokens':
    case 'visiblePlanMinUsableRatio':
      return `Visible plans are currently ${
        preview.visiblePlanAffordable ? 'affordable' : 'skipped'
      }.`;
    case 'changeImpactMinUsableTokens':
    case 'changeImpactMinUsableRatio':
      return `Change impact is currently ${
        preview.changeImpactAffordable ? 'affordable' : 'skipped'
      }.`;
    case 'diagnosticStepsBase':
    case 'diagnosticStepsPerUsable':
    case 'diagnosticStepsMax':
      return `Drafted plans currently allow ${formatCount(
        preview.maxDiagnosticSteps,
      )} diagnostic steps.`;
    case 'maxSkillsBase':
    case 'maxSkillsPerUsable':
    case 'maxSkillsCap':
      return `Skill selection currently allows ${formatCount(
        preview.maxSkills,
      )} skills.`;
    case 'verificationChecksBase':
    case 'verificationChecksPerUsable':
    case 'verificationChecksMax':
      return `Verification currently allows ${formatCount(
        preview.maxVerificationChecks,
      )} checks.`;
    default:
      return 'This value participates in the current derived window policy.';
  }
}

function tokenBudgetShareText(
  field: TokenBudgetFieldDescriptor,
  value: number,
  preview: TokenBudgetPreview,
): string {
  const base = ratioBase(field.key, preview);
  if (field.kind === 'ratio' && base) {
    return `Share of 100%: ${formatPercent(value)} of ${base.label}.`;
  }
  if (
    field.key.endsWith('Min') ||
    field.key.endsWith('Max') ||
    field.key.endsWith('Cap') ||
    field.key.endsWith('Tokens')
  ) {
    const basis = Math.max(1, preview.contextWindowTokens);
    return `Equivalent to ${formatPercent(value / basis)} of the current context window if this clamp applies.`;
  }
  return 'Share of 100%: derived indirectly; this is a divisor/base value, not a direct budget slice.';
}

function tokenBudgetScalingText(
  field: TokenBudgetFieldDescriptor,
  value: number,
  preview: TokenBudgetPreview,
): string {
  const base = ratioBase(field.key, preview);
  if (field.kind === 'ratio' && base) {
    return scaledRatioExample(value, base, preview);
  }
  if (
    field.key.endsWith('Min') ||
    field.key.endsWith('Max') ||
    field.key.endsWith('Cap')
  ) {
    return 'As the context window changes, the paired ratio scales first; this value only clamps the derived result.';
  }
  if (field.key.includes('Per') || field.key === 'filesPerOutputTokens') {
    return 'As usable or output tokens grow, the derived count grows by this divisor until its cap applies.';
  }
  return 'This is an absolute threshold; larger windows change when it is reached relative to the full 100%.';
}

export function TokenBudgetFieldHelp({
  field,
  value,
  preview,
}: {
  field: TokenBudgetFieldDescriptor;
  value: number;
  preview: TokenBudgetPreview;
}) {
  const href = fieldDocsHref(field);
  const effect = appliedTokenBudgetEffect(field.key, preview);
  const scale = tokenBudgetScalingText(field, value, preview);
  const share = tokenBudgetShareText(field, value, preview);

  return (
    <div className="token-budget-field-help">
      <div className="token-budget-field-help__top">
        <span>{field.description}</span>
        <a
          className="token-budget-help-link"
          href={href}
          target="_blank"
          rel="noreferrer"
          title={`${field.label}. ${effect} ${scale}`}
          aria-label={`Read more about ${field.label}`}
        >
          <IconHelpCircle />
        </a>
      </div>
      <p>{effect}</p>
      <p>{scale}</p>
      <p>{share}</p>
      <a
        className="token-budget-read-more"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        Read more
      </a>
    </div>
  );
}
