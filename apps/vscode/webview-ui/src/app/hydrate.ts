import { DEFAULT_CONTEXT_TOGGLES, DEFAULT_RUN_BUDGET, DEFAULT_TOKEN_BUDGET, DEFAULT_LOOP_POLICY, DEFAULT_POLICY_LAB, DEFAULT_UI, DEFAULT_AUTOCOMPLETE, DEFAULT_SEARCH } from '../app/uiDefaults';
import { type AutocompleteSettingsSnapshot, type SearchSettingsSnapshot, type UiSettingsSnapshot } from '../protocol';

export function hydrateAutocompleteSnapshot(
  raw: Partial<AutocompleteSettingsSnapshot> | undefined,
): AutocompleteSettingsSnapshot {
  return {
    ...DEFAULT_AUTOCOMPLETE,
    ...(raw ?? {}),
    provider: 'openai-compatible',
  };
}

export function hydrateSearchSnapshot(
  raw: Partial<SearchSettingsSnapshot> | undefined,
): SearchSettingsSnapshot {
  return {
    ...DEFAULT_SEARCH,
    ...(raw ?? {}),
    searxngBaseUrl: raw?.searxngBaseUrl?.trim() ?? '',
    hasApiKey: Boolean(raw?.hasApiKey),
  };
}

export type SettingsMode = 'ask' | 'plan' | 'agent';

export function hydrateUiSnapshot(
  raw: Partial<UiSettingsSnapshot> | undefined,
): UiSettingsSnapshot {
  return {
    ...DEFAULT_UI,
    ...(raw ?? {}),
    features: {
      ...DEFAULT_UI.features,
      ...(raw?.features ?? {}),
    },
    modeDefaults: {
      ...DEFAULT_UI.modeDefaults,
      ...(raw?.modeDefaults ?? {}),
    },
    contextToggles: {
      ...DEFAULT_CONTEXT_TOGGLES,
      ...(raw?.contextToggles ?? {}),
    },
    runBudget: {
      ...DEFAULT_RUN_BUDGET,
      ...(raw?.runBudget ?? {}),
    },
    tokenBudget: {
      ...DEFAULT_TOKEN_BUDGET,
      ...(raw?.tokenBudget ?? {}),
      policy: {
        ...DEFAULT_TOKEN_BUDGET.policy,
        ...(raw?.tokenBudget?.policy ?? {}),
      },
      fields: raw?.tokenBudget?.fields?.length
        ? raw.tokenBudget.fields
        : DEFAULT_TOKEN_BUDGET.fields,
      preview: raw?.tokenBudget?.preview ?? DEFAULT_TOKEN_BUDGET.preview,
    },
    loopPolicy: {
      ...DEFAULT_LOOP_POLICY,
      ...(raw?.loopPolicy ?? {}),
      thresholds: {
        ...DEFAULT_LOOP_POLICY.thresholds,
        ...(raw?.loopPolicy?.thresholds ?? {}),
      },
      bandThresholds: {
        ...DEFAULT_LOOP_POLICY.bandThresholds,
        ...(raw?.loopPolicy?.bandThresholds ?? {}),
      },
      band: raw?.loopPolicy?.band ?? DEFAULT_LOOP_POLICY.band,
      fields: raw?.loopPolicy?.fields?.length
        ? raw.loopPolicy.fields
        : DEFAULT_LOOP_POLICY.fields,
    },
    v8LoopPolicy: {
      ...DEFAULT_LOOP_POLICY,
      ...(raw?.v8LoopPolicy ?? {}),
      thresholds: {
        ...DEFAULT_LOOP_POLICY.thresholds,
        ...(raw?.v8LoopPolicy?.thresholds ?? {}),
      },
      bandThresholds: {
        ...DEFAULT_LOOP_POLICY.bandThresholds,
        ...(raw?.v8LoopPolicy?.bandThresholds ?? {}),
      },
      band: raw?.v8LoopPolicy?.band ?? DEFAULT_LOOP_POLICY.band,
      fields: raw?.v8LoopPolicy?.fields?.length
        ? raw.v8LoopPolicy.fields
        : DEFAULT_LOOP_POLICY.fields,
    },
    policyLab: {
      ...DEFAULT_POLICY_LAB,
      ...(raw?.policyLab ?? {}),
      activeBand: raw?.policyLab?.activeBand ?? DEFAULT_POLICY_LAB.activeBand,
      bands: raw?.policyLab?.bands?.length
        ? raw.policyLab.bands
        : DEFAULT_POLICY_LAB.bands,
      loopByBand: {
        compact: {
          ...DEFAULT_POLICY_LAB.loopByBand.compact,
          ...(raw?.policyLab?.loopByBand?.compact ?? {}),
        },
        standard: {
          ...DEFAULT_POLICY_LAB.loopByBand.standard,
          ...(raw?.policyLab?.loopByBand?.standard ?? {}),
        },
        wide: {
          ...DEFAULT_POLICY_LAB.loopByBand.wide,
          ...(raw?.policyLab?.loopByBand?.wide ?? {}),
        },
      },
      windowByBand: {
        compact: {
          ...DEFAULT_POLICY_LAB.windowByBand.compact,
          ...(raw?.policyLab?.windowByBand?.compact ?? {}),
        },
        standard: {
          ...DEFAULT_POLICY_LAB.windowByBand.standard,
          ...(raw?.policyLab?.windowByBand?.standard ?? {}),
        },
        wide: {
          ...DEFAULT_POLICY_LAB.windowByBand.wide,
          ...(raw?.policyLab?.windowByBand?.wide ?? {}),
        },
      },
      loopOverrides: {
        ...DEFAULT_POLICY_LAB.loopOverrides,
        ...(raw?.policyLab?.loopOverrides ?? {}),
      },
      windowOverrides: {
        ...DEFAULT_POLICY_LAB.windowOverrides,
        ...(raw?.policyLab?.windowOverrides ?? {}),
      },
      loopThresholds: {
        ...DEFAULT_POLICY_LAB.loopThresholds,
        ...(raw?.policyLab?.loopThresholds ?? {}),
      },
      loopBandThresholds: {
        ...DEFAULT_POLICY_LAB.loopBandThresholds,
        ...(raw?.policyLab?.loopBandThresholds ?? {}),
      },
      windowPolicy: {
        ...DEFAULT_POLICY_LAB.windowPolicy,
        ...(raw?.policyLab?.windowPolicy ?? {}),
      },
      windowBandPolicy: {
        ...DEFAULT_POLICY_LAB.windowBandPolicy,
        ...(raw?.policyLab?.windowBandPolicy ?? {}),
      },
      loopFields: raw?.policyLab?.loopFields?.length
        ? raw.policyLab.loopFields
        : DEFAULT_POLICY_LAB.loopFields,
      windowFields: raw?.policyLab?.windowFields?.length
        ? raw.policyLab.windowFields
        : DEFAULT_POLICY_LAB.windowFields,
      shipPreviewNote:
        raw?.policyLab?.shipPreviewNote ?? DEFAULT_POLICY_LAB.shipPreviewNote,
    },
  };
}
