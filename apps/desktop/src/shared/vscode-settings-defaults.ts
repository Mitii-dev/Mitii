/**
 * Canonical Mitii settings defaults — generated from apps/vscode package.json
 * contributes.configuration (all mitii.* keys). Do not hand-edit field lists;
 * regenerate via scripts if VS Code settings change.
 */
export const DEFAULT_DESKTOP_SETTINGS = {
  "developer": {
    "enabled": false,
    "intensityOverrides": false,
    "modelIo": false
  },
  "debug": false,
  "tokenBudget": {
    "enabled": false,
    "outputRatio": 0.1,
    "outputMinTokens": 1024,
    "outputMaxTokens": 512000,
    "outputWindowCapRatio": 0.2,
    "toolSchemaFallbackTokens": 8000,
    "toolSchemaFallbackWindowRatio": 0.2,
    "minimumUsableInputTokens": 2048,
    "loopSafetyRatio": 0.94,
    "repositoryShare": 0.28,
    "conversationShare": 0.4,
    "planShare": 0.06,
    "skillsShare": 0.04,
    "planTokensCap": 32000,
    "skillsTokensCap": 16000,
    "repositoryTokensCap": 128000,
    "compactionWarnRatio": 0.7,
    "compactionAutoRatio": 0.8,
    "compactionHardRatio": 0.92,
    "keepRecentToolResultsRatio": 0.00008,
    "keepRecentToolResultsMin": 3,
    "keepRecentToolResultsMax": 16,
    "compactedToolResultCharsRatio": 0.006,
    "compactedToolResultCharsMin": 400,
    "compactedToolResultCharsMax": 4000,
    "compactedToolArgumentCharsRatio": 0.003,
    "compactedToolArgumentCharsMin": 256,
    "compactedToolArgumentCharsMax": 2000,
    "toolResultContentCharsRatio": 0.015,
    "toolResultContentCharsMin": 2000,
    "toolResultContentCharsMax": 64000,
    "droppedTurnSummaryCharsRatio": 0.01,
    "droppedTurnSummaryCharsMin": 1200,
    "droppedTurnSummaryCharsMax": 8000,
    "establishedFactCharsRatio": 0.002,
    "establishedFactCharsMin": 220,
    "establishedFactCharsMax": 900,
    "establishedFactCountRatio": 0.00015,
    "establishedFactCountMin": 12,
    "establishedFactCountMax": 48,
    "establishedFactReinjectCharsRatio": 0.012,
    "establishedFactReinjectCharsMin": 1600,
    "establishedFactReinjectCharsMax": 8000,
    "memoryReinjectCharsRatio": 0.006,
    "memoryReinjectCharsMin": 800,
    "memoryReinjectCharsMax": 4000,
    "filesPerOutputTokens": 800,
    "minUniqueFilesPerCall": 2,
    "maxUniqueFilesPerCallCap": 48,
    "patchPayloadOutputRatio": 0.6,
    "charsPerOutputToken": 3,
    "requireBatchedBelowOutputTokens": 4096,
    "visiblePlanMinUsableTokens": 40000,
    "changeImpactMinUsableTokens": 40000,
    "diagnosticStepsBase": 2,
    "diagnosticStepsPerUsable": 20000,
    "diagnosticStepsMax": 8,
    "maxModelCallsPerUsable": 2500,
    "maxModelCallsMin": 48,
    "maxModelCallsMax": 96,
    "maxSkillsBase": 1,
    "maxSkillsPerUsable": 30000,
    "maxSkillsCap": 4,
    "verificationChecksBase": 2,
    "verificationChecksPerUsable": 40000,
    "verificationChecksMax": 16,
    "visiblePlanMinUsableRatio": 0.35,
    "changeImpactMinUsableRatio": 0.35,
    "maxPatchesPerCallCap": 96
  },
  "loopPolicy": {
    "enabled": false,
    "explorationRereadMinCalls": 8,
    "explorationRereadRatio": 2,
    "maxExplorationStallNudges": 1,
    "maxReadOnlyToolTurnsBeforeMutationNudge": 6,
    "maxReadOnlyMutationRetryAttempts": 2,
    "maxReadOnlyToolTurnsAfterMutationNudge": 3,
    "maxReadOnlyToolTurnsAfterMutationNudges": 1,
    "maxTruncationRecoveries": 3,
    "maxIncompleteAnswerRecoveries": 2,
    "maxUnfulfilledExecuteRecoveries": 1,
    "maxRejectedMutationRecoveries": 3,
    "maxMustReadNudges": 1,
    "verificationRepairModelCallReserveRatio": 0.2,
    "maxVerificationRepairAttempts": 8,
    "maxStalledVerificationRepairs": 2,
    "defaultPreferredBatchSize": 8,
    "defaultMaxPatchesPerCall": 16,
    "maxRecoveredAnalysisChars": 480,
    "maxStructuredReviewRecoveries": 2
  },
  "provider": {
    "type": "openai-compatible",
    "preset": "ollama",
    "baseUrl": "http://127.0.0.1:11434/v1",
    "model": "",
    "contextWindow": 0,
    "maximumOutputTokens": 0
  },
  "search": {
    "searxngBaseUrl": ""
  },
  "autocomplete": {
    "enabled": false,
    "mode": "fim",
    "provider": "openai-compatible",
    "baseUrl": "",
    "model": "",
    "endpointPath": "completions",
    "authHeader": "authorization",
    "maxTokens": 96,
    "debounceMs": 250,
    "timeoutMs": 4000,
    "prefixChars": 6000,
    "suffixChars": 2000,
    "temperature": 0.2
  },
  "semanticIndex": {
    "enabled": true,
    "source": "bundled",
    "backend": "auto",
    "model": "",
    "dimensions": 0,
    "normalized": true
  },
  "workspace": {
    "rootPathOverride": "",
    "maximumIndexFiles": 0
  },
  "skills": {
    "workspace": {
      "enabled": true
    }
  },
  "ui": {
    "showReasoning": true,
    "features": {
      "codeReviewButton": false
    },
    "reasoningPreviewMaxChars": 8000,
    "depth": "auto",
    "effort": "medium",
    "modeDefaults": {
      "ask": {
        "thoroughness": "medium",
        "depth": "auto",
        "approvalMode": "guided",
        "model": ""
      },
      "plan": {
        "thoroughness": "high",
        "depth": "deep",
        "approvalMode": "guided",
        "model": ""
      },
      "agent": {
        "thoroughness": "medium",
        "depth": "auto",
        "approvalMode": "safe",
        "model": ""
      }
    },
    "contextToggles": {
      "repoMap": false,
      "diagnostics": true,
      "gitDiff": false,
      "editor": true,
      "openTabs": false,
      "memory": true
    }
  },
  "agent": {
    "taskListAutoAdvance": true
  },
  "scm": {
    "commitMessageStyle": "conventional"
  },
  "safety": {
    "approvalMode": "guided",
    "sandbox": {
      "enabled": null,
      "network": null,
      "backend": "auto"
    }
  },
  "tools": {
    "applyPatch": {
      "fuzzyMatch": false
    }
  },
  "runBudget": {
    "unlimited": false,
    "maxModelCalls": 64,
    "maxToolCalls": 128,
    "maxLoopIterations": 96,
    "maxWallTimeMinutes": 30
  },
  "logVerbosity": "verbose",
  "onboarding": {
    "completed": false
  },
  "mcp": {
    "enabled": false,
    "servers": []
  }
} as const;

/** Widen literals so settings can be edited at runtime. */
type WidenPrimitives<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : T;

type DeepMutable<T> = T extends ReadonlyArray<infer U>
  ? Array<DeepMutable<[U] extends [never] ? unknown : U>>
  : T extends object
    ? { -readonly [P in keyof T]: DeepMutable<T[P]> }
    : WidenPrimitives<T>;

export type DesktopSettings = DeepMutable<typeof DEFAULT_DESKTOP_SETTINGS>;

export type SettingsCatalogEntry = {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

export const SETTINGS_CATALOG: Record<string, SettingsCatalogEntry> = {
  "mitii.developer.enabled": {
    "type": "boolean",
    "description": "Unlock developer options in the Mitii Settings → Developer page (nested debug switches appear after this is enabled)",
    "default": false
  },
  "mitii.developer.intensityOverrides": {
    "type": "boolean",
    "description": "Edit exploration depth and working-set effort separately instead of the clubbed Thoroughness control. Requires mitii.developer.enabled.",
    "default": false
  },
  "mitii.debug": {
    "type": "boolean",
    "description": "Enable debug logging in the Mitii Output channel (auto-shows the channel; includes stack traces on failures). Requires mitii.developer.enabled in Settings → Developer.",
    "default": false
  },
  "mitii.developer.modelIo": {
    "type": "boolean",
    "description": "When developer settings are enabled, write sanitized model request/response bodies to a separate *-model-io.jsonl under .mitii/logs/. Large and may include workspace content — keep local. Use Mitii: Export Shareable Diagnostic for a redacted one-file paste for online help.",
    "default": false
  },
  "mitii.tokenBudget.enabled": {
    "type": "boolean",
    "description": "Use custom Window Budget ratios from mitii.tokenBudget.* instead of built-in defaults. Requires developer settings in the Mitii Debug tab.",
    "default": false
  },
  "mitii.tokenBudget.outputRatio": {
    "type": "number",
    "description": "Fraction of the context window reserved for model output when max output is 0.",
    "default": 0.1,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.outputMinTokens": {
    "type": "number",
    "description": "Floor for the derived output reserve.",
    "default": 1024,
    "minimum": 1
  },
  "mitii.tokenBudget.outputMaxTokens": {
    "type": "number",
    "description": "Ceiling for the derived output reserve. Prefer leaving this high so outputWindowCapRatio and the context window govern the reserve.",
    "default": 512000,
    "minimum": 1
  },
  "mitii.tokenBudget.outputWindowCapRatio": {
    "type": "number",
    "description": "Output cannot exceed this fraction of the advertised window.",
    "default": 0.2,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.toolSchemaFallbackTokens": {
    "type": "number",
    "description": "Fallback tool-JSON tokens when tool schemas have not been measured.",
    "default": 8000,
    "minimum": 0
  },
  "mitii.tokenBudget.toolSchemaFallbackWindowRatio": {
    "type": "number",
    "description": "Fallback tool cost cannot exceed this fraction of the window.",
    "default": 0.2,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.minimumUsableInputTokens": {
    "type": "number",
    "description": "Keep at least this many tokens for prompt and history after output and tools.",
    "default": 2048,
    "minimum": 1
  },
  "mitii.tokenBudget.loopSafetyRatio": {
    "type": "number",
    "description": "Fraction of usable input allowed in the live model-loop budget.",
    "default": 0.94,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.repositoryShare": {
    "type": "number",
    "description": "Share of usable input for repository context.",
    "default": 0.28,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.conversationShare": {
    "type": "number",
    "description": "Share of usable input for conversation and tool history.",
    "default": 0.4,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.planShare": {
    "type": "number",
    "description": "Share of usable input for plan text.",
    "default": 0.06,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.skillsShare": {
    "type": "number",
    "description": "Share of usable input for selected skill bodies.",
    "default": 0.04,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.planTokensCap": {
    "type": "number",
    "description": "Hard cap on plan tokens regardless of share.",
    "default": 32000,
    "minimum": 1
  },
  "mitii.tokenBudget.skillsTokensCap": {
    "type": "number",
    "description": "Hard cap on skill-body tokens regardless of share.",
    "default": 16000,
    "minimum": 1
  },
  "mitii.tokenBudget.repositoryTokensCap": {
    "type": "number",
    "description": "Hard cap on repository-context tokens regardless of share.",
    "default": 128000,
    "minimum": 1
  },
  "mitii.tokenBudget.compactionWarnRatio": {
    "type": "number",
    "description": "Loop pressure warning fires at this fraction of the loop budget.",
    "default": 0.7,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.compactionAutoRatio": {
    "type": "number",
    "description": "Automatic history compaction starts at this fraction of the loop budget.",
    "default": 0.8,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.compactionHardRatio": {
    "type": "number",
    "description": "Aggressive compaction and memory reinject at this fraction of the loop budget.",
    "default": 0.92,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.keepRecentToolResultsRatio": {
    "type": "number",
    "description": "Fraction of usable input converted to the count of recent tool results kept in full.",
    "default": 0.00008,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.keepRecentToolResultsMin": {
    "type": "number",
    "description": "Floor for recent tool results kept in full.",
    "default": 3,
    "minimum": 1
  },
  "mitii.tokenBudget.keepRecentToolResultsMax": {
    "type": "number",
    "description": "Maximum number of recent tool results kept in full.",
    "default": 16,
    "minimum": 1
  },
  "mitii.tokenBudget.compactedToolResultCharsRatio": {
    "type": "number",
    "description": "Fraction of usable input converted to compacted tool-result characters.",
    "default": 0.006,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.compactedToolResultCharsMin": {
    "type": "number",
    "description": "Floor for compacted tool-result characters.",
    "default": 400,
    "minimum": 1
  },
  "mitii.tokenBudget.compactedToolResultCharsMax": {
    "type": "number",
    "description": "Ceiling for compacted tool-result characters.",
    "default": 4000,
    "minimum": 1
  },
  "mitii.tokenBudget.compactedToolArgumentCharsRatio": {
    "type": "number",
    "description": "Fraction of usable input converted to compacted tool-argument characters.",
    "default": 0.003,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.compactedToolArgumentCharsMin": {
    "type": "number",
    "description": "Floor for compacted tool-argument characters.",
    "default": 256,
    "minimum": 1
  },
  "mitii.tokenBudget.compactedToolArgumentCharsMax": {
    "type": "number",
    "description": "Ceiling for compacted tool-argument characters.",
    "default": 2000,
    "minimum": 1
  },
  "mitii.tokenBudget.toolResultContentCharsRatio": {
    "type": "number",
    "description": "Fraction of usable input converted to live tool-result content characters.",
    "default": 0.015,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.toolResultContentCharsMin": {
    "type": "number",
    "description": "Floor for live tool-result content characters.",
    "default": 2000,
    "minimum": 1
  },
  "mitii.tokenBudget.toolResultContentCharsMax": {
    "type": "number",
    "description": "Ceiling for live tool-result content characters.",
    "default": 64000,
    "minimum": 1
  },
  "mitii.tokenBudget.droppedTurnSummaryCharsRatio": {
    "type": "number",
    "description": "Fraction of usable input converted to dropped-turn summary characters.",
    "default": 0.01,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.droppedTurnSummaryCharsMin": {
    "type": "number",
    "description": "Floor for dropped-turn summary characters.",
    "default": 1200,
    "minimum": 1
  },
  "mitii.tokenBudget.droppedTurnSummaryCharsMax": {
    "type": "number",
    "description": "Ceiling for dropped-turn summary characters.",
    "default": 8000,
    "minimum": 1
  },
  "mitii.tokenBudget.establishedFactCharsRatio": {
    "type": "number",
    "description": "Fraction of usable input converted to each retained observation character budget.",
    "default": 0.002,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.establishedFactCharsMin": {
    "type": "number",
    "description": "Floor for each retained observation.",
    "default": 220,
    "minimum": 1
  },
  "mitii.tokenBudget.establishedFactCharsMax": {
    "type": "number",
    "description": "Ceiling for each retained observation.",
    "default": 900,
    "minimum": 1
  },
  "mitii.tokenBudget.establishedFactCountRatio": {
    "type": "number",
    "description": "Fraction of usable input converted to retained observation count.",
    "default": 0.00015,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.establishedFactCountMin": {
    "type": "number",
    "description": "Floor for retained observation count.",
    "default": 12,
    "minimum": 1
  },
  "mitii.tokenBudget.establishedFactCountMax": {
    "type": "number",
    "description": "Ceiling for retained observation count.",
    "default": 48,
    "minimum": 1
  },
  "mitii.tokenBudget.establishedFactReinjectCharsRatio": {
    "type": "number",
    "description": "Fraction of usable input converted to observation reinjection characters.",
    "default": 0.012,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.establishedFactReinjectCharsMin": {
    "type": "number",
    "description": "Floor for observation reinjection characters.",
    "default": 1600,
    "minimum": 1
  },
  "mitii.tokenBudget.establishedFactReinjectCharsMax": {
    "type": "number",
    "description": "Ceiling for observation reinjection characters.",
    "default": 8000,
    "minimum": 1
  },
  "mitii.tokenBudget.memoryReinjectCharsRatio": {
    "type": "number",
    "description": "Fraction of usable input converted to memory reinjection characters.",
    "default": 0.006,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.memoryReinjectCharsMin": {
    "type": "number",
    "description": "Floor for memory reinjection characters.",
    "default": 800,
    "minimum": 1
  },
  "mitii.tokenBudget.memoryReinjectCharsMax": {
    "type": "number",
    "description": "Ceiling for memory reinjection characters.",
    "default": 4000,
    "minimum": 1
  },
  "mitii.tokenBudget.filesPerOutputTokens": {
    "type": "number",
    "description": "Unique files per mutation call scale as (context window × output ratio) / this value.",
    "default": 800,
    "minimum": 1
  },
  "mitii.tokenBudget.minUniqueFilesPerCall": {
    "type": "number",
    "description": "Floor for files allowed in one mutation call.",
    "default": 2,
    "minimum": 1
  },
  "mitii.tokenBudget.maxUniqueFilesPerCallCap": {
    "type": "number",
    "description": "Ceiling for files allowed in one mutation call.",
    "default": 48,
    "minimum": 1
  },
  "mitii.tokenBudget.patchPayloadOutputRatio": {
    "type": "number",
    "description": "Fraction of output tokens treated as patch payload capacity.",
    "default": 0.6,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.charsPerOutputToken": {
    "type": "number",
    "description": "Approximate characters produced per output token for payload sizing.",
    "default": 3,
    "minimum": 1
  },
  "mitii.tokenBudget.requireBatchedBelowOutputTokens": {
    "type": "number",
    "description": "Force batched mutation when derived output is below this many tokens.",
    "default": 4096,
    "minimum": 0
  },
  "mitii.tokenBudget.visiblePlanMinUsableTokens": {
    "type": "number",
    "description": "Visible plans are skipped when usable input is below this.",
    "default": 40000,
    "minimum": 0
  },
  "mitii.tokenBudget.changeImpactMinUsableTokens": {
    "type": "number",
    "description": "Change-impact analysis is skipped when usable input is below this.",
    "default": 40000,
    "minimum": 0
  },
  "mitii.tokenBudget.diagnosticStepsBase": {
    "type": "number",
    "description": "Minimum diagnostic change steps in a drafted plan.",
    "default": 2,
    "minimum": 1
  },
  "mitii.tokenBudget.diagnosticStepsPerUsable": {
    "type": "number",
    "description": "Add one diagnostic step per this many usable-input tokens.",
    "default": 20000,
    "minimum": 1
  },
  "mitii.tokenBudget.diagnosticStepsMax": {
    "type": "number",
    "description": "Ceiling for diagnostic change steps.",
    "default": 8,
    "minimum": 1
  },
  "mitii.tokenBudget.maxModelCallsPerUsable": {
    "type": "number",
    "description": "Suggested model-call cap scales as usable input / this value.",
    "default": 2500,
    "minimum": 1
  },
  "mitii.tokenBudget.maxModelCallsMin": {
    "type": "number",
    "description": "Floor for the window-derived model-call cap.",
    "default": 48,
    "minimum": 1
  },
  "mitii.tokenBudget.maxModelCallsMax": {
    "type": "number",
    "description": "Ceiling for the window-derived model-call cap when Modes run budget is limited.",
    "default": 96,
    "minimum": 1
  },
  "mitii.tokenBudget.maxSkillsBase": {
    "type": "number",
    "description": "Minimum number of skills that may be selected.",
    "default": 1,
    "minimum": 1
  },
  "mitii.tokenBudget.maxSkillsPerUsable": {
    "type": "number",
    "description": "Add one selectable skill per this many usable-input tokens.",
    "default": 30000,
    "minimum": 1
  },
  "mitii.tokenBudget.maxSkillsCap": {
    "type": "number",
    "description": "Ceiling for selected skills.",
    "default": 4,
    "minimum": 1
  },
  "mitii.tokenBudget.verificationChecksBase": {
    "type": "number",
    "description": "Minimum verification checks after mutations.",
    "default": 2,
    "minimum": 1
  },
  "mitii.tokenBudget.verificationChecksPerUsable": {
    "type": "number",
    "description": "Add one verification check per this many usable-input tokens.",
    "default": 40000,
    "minimum": 1
  },
  "mitii.tokenBudget.verificationChecksMax": {
    "type": "number",
    "description": "Ceiling for verification checks.",
    "default": 16,
    "minimum": 1
  },
  "mitii.loopPolicy.enabled": {
    "type": "boolean",
    "description": "Use custom Agent Engine loop/stall thresholds from mitii.loopPolicy.* instead of shipped working standards. Requires developer settings.",
    "default": false
  },
  "mitii.loopPolicy.explorationRereadMinCalls": {
    "type": "number",
    "description": "Stall check starts after this many file-read calls in the current loop.",
    "default": 8,
    "minimum": 1
  },
  "mitii.loopPolicy.explorationRereadRatio": {
    "type": "number",
    "description": "Trip when file-read calls ≥ unique paths × this ratio.",
    "default": 2,
    "minimum": 1
  },
  "mitii.loopPolicy.maxExplorationStallNudges": {
    "type": "number",
    "description": "Mid-loop nudges before exploration_stall_broken.",
    "default": 1,
    "minimum": 0
  },
  "mitii.loopPolicy.maxReadOnlyToolTurnsBeforeMutationNudge": {
    "type": "number",
    "description": "Read/search turns before requiring apply_patch in execute mode.",
    "default": 6,
    "minimum": 1
  },
  "mitii.loopPolicy.maxReadOnlyMutationRetryAttempts": {
    "type": "number",
    "description": "Extra read-only turns after the first-mutation nudge.",
    "default": 2,
    "minimum": 0
  },
  "mitii.loopPolicy.maxReadOnlyToolTurnsAfterMutationNudge": {
    "type": "number",
    "description": "Non-mutating turns allowed after the first successful mutation.",
    "default": 3,
    "minimum": 1
  },
  "mitii.loopPolicy.maxReadOnlyToolTurnsAfterMutationNudges": {
    "type": "number",
    "description": "Post-mutation read nudges before stopping the first loop.",
    "default": 1,
    "minimum": 0
  },
  "mitii.loopPolicy.maxTruncationRecoveries": {
    "type": "number",
    "description": "Retries after finishReason=length with incomplete tools.",
    "default": 3,
    "minimum": 0
  },
  "mitii.loopPolicy.maxIncompleteAnswerRecoveries": {
    "type": "number",
    "description": "Nudges for empty or transitional narration with no tools.",
    "default": 2,
    "minimum": 0
  },
  "mitii.loopPolicy.maxUnfulfilledExecuteRecoveries": {
    "type": "number",
    "description": "Nudges when execute ends on diagnosis instead of apply_patch.",
    "default": 1,
    "minimum": 0
  },
  "mitii.loopPolicy.maxRejectedMutationRecoveries": {
    "type": "number",
    "description": "Retries after apply_patch/delete_file/move_file is rejected (e.g. stale oldText).",
    "default": 3,
    "minimum": 0
  },
  "mitii.loopPolicy.maxMustReadNudges": {
    "type": "number",
    "description": "Times to withhold a mutation when mustRead paths are not loaded.",
    "default": 1,
    "minimum": 0
  },
  "mitii.loopPolicy.verificationRepairModelCallReserveRatio": {
    "type": "number",
    "description": "Fraction of maxModelCalls reserved for verification repair.",
    "default": 0.2,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.loopPolicy.maxVerificationRepairAttempts": {
    "type": "number",
    "description": "Fallback remaining-error repair cap when Window Policy is absent.",
    "default": 8,
    "minimum": 0
  },
  "mitii.loopPolicy.maxStalledVerificationRepairs": {
    "type": "number",
    "description": "Stop repairing after this many consecutive non-improving verifies.",
    "default": 2,
    "minimum": 1
  },
  "mitii.loopPolicy.defaultPreferredBatchSize": {
    "type": "number",
    "description": "Fallback preferred mutation batch size.",
    "default": 8,
    "minimum": 1
  },
  "mitii.loopPolicy.defaultMaxPatchesPerCall": {
    "type": "number",
    "description": "Fallback hard patch cap per apply_patch call.",
    "default": 16,
    "minimum": 1
  },
  "mitii.loopPolicy.maxRecoveredAnalysisChars": {
    "type": "number",
    "description": "Max characters kept from mid-work analysis dumps in the transcript.",
    "default": 480,
    "minimum": 64
  },
  "mitii.provider.type": {
    "type": "string",
    "enum": [
      "echo",
      "openai-compatible",
      "anthropic",
      "gemini"
    ],
    "description": "LLM provider adapter: echo, OpenAI-compatible (/v1), Anthropic Messages (Claude), or Gemini.",
    "default": "echo"
  },
  "mitii.provider.preset": {
    "type": "string",
    "enum": [
      "echo",
      "ollama",
      "ollama-cloud",
      "lm-studio",
      "openai",
      "openrouter",
      "deepseek",
      "azure-openai",
      "openai-compatible",
      "anthropic",
      "gemini"
    ],
    "description": "Provider preset that prefills base URL, model, and adapter. Use openai-compatible for any /v1 chat completions API.",
    "default": "echo"
  },
  "mitii.provider.baseUrl": {
    "type": "string",
    "description": "Provider API base URL (OpenAI-compatible /v1, https://api.anthropic.com, https://ollama.com/v1, or https://generativelanguage.googleapis.com).",
    "default": ""
  },
  "mitii.provider.model": {
    "type": "string",
    "description": "Model id (for example gpt-4o-mini, claude-sonnet-4-5, gemini-2.5-flash, deepseek-chat).",
    "default": ""
  },
  "mitii.provider.contextWindow": {
    "type": "number",
    "description": "Model context window in tokens. Set 0 to use the model preset; use a positive value only when your runtime has a different limit. Retrieval, compaction, mutation batches, and verification scale from this window automatically. Developer token-budget fields are optional.",
    "default": 0,
    "minimum": 0
  },
  "mitii.provider.maximumOutputTokens": {
    "type": "number",
    "description": "Maximum tokens the model may generate per call. Set 0 to derive the reserve from the context window (recommended; ~20% of the window, at least 4096 when the window allows). A positive value is a hard host override. The legacy default 5000 is ignored so apply_patch batches are not truncated. Leave at 0 unless your runtime has a different hard cap.",
    "default": 0,
    "minimum": 0
  },
  "mitii.search.searxngBaseUrl": {
    "type": "string",
    "description": "SearXNG base URL for free local/self-hosted web_search (e.g. http://127.0.0.1:8080). Takes precedence over SEARXNG_BASE_URL / MITII_SEARXNG_URL. Leave empty to use env or Brave/Tavily keys only.",
    "default": ""
  },
  "mitii.autocomplete.enabled": {
    "type": "boolean",
    "description": "Enable inline FIM autocomplete suggestions in file-backed editors.",
    "default": false
  },
  "mitii.autocomplete.mode": {
    "type": "string",
    "enum": [
      "fim",
      "next-edit"
    ],
    "description": "Inline completion mode: classic fill-in-the-middle (fim) or next-edit span prediction.",
    "default": "fim"
  },
  "mitii.autocomplete.provider": {
    "type": "string",
    "enum": [
      "openai-compatible"
    ],
    "description": "Autocomplete provider adapter. The first implementation supports OpenAI-compatible FIM/completions endpoints.",
    "default": "openai-compatible"
  },
  "mitii.autocomplete.baseUrl": {
    "type": "string",
    "description": "Autocomplete API base URL. Empty inherits mitii.provider.baseUrl.",
    "default": ""
  },
  "mitii.autocomplete.model": {
    "type": "string",
    "description": "Autocomplete model id. Empty inherits mitii.provider.model.",
    "default": ""
  },
  "mitii.autocomplete.endpointPath": {
    "type": "string",
    "description": "Path appended to the autocomplete base URL, such as completions or fim/completions.",
    "default": "completions"
  },
  "mitii.autocomplete.authHeader": {
    "type": "string",
    "enum": [
      "authorization",
      "api-key",
      "x-api-key"
    ],
    "description": "Header used when sending the existing Mitii provider API key to the autocomplete endpoint.",
    "default": "authorization"
  },
  "mitii.autocomplete.maxTokens": {
    "type": "number",
    "description": "Maximum tokens requested for each inline autocomplete suggestion.",
    "default": 96,
    "minimum": 1,
    "maximum": 512
  },
  "mitii.autocomplete.debounceMs": {
    "type": "number",
    "description": "Typing pause before Mitii sends an autocomplete request.",
    "default": 250,
    "minimum": 0,
    "maximum": 2000
  },
  "mitii.autocomplete.timeoutMs": {
    "type": "number",
    "description": "Maximum time to wait for an autocomplete response before failing closed.",
    "default": 4000,
    "minimum": 250,
    "maximum": 30000
  },
  "mitii.autocomplete.prefixChars": {
    "type": "number",
    "description": "Maximum characters before the cursor sent as FIM prefix context.",
    "default": 6000,
    "minimum": 128,
    "maximum": 60000
  },
  "mitii.autocomplete.suffixChars": {
    "type": "number",
    "description": "Maximum characters after the cursor sent as FIM suffix context.",
    "default": 2000,
    "minimum": 0,
    "maximum": 60000
  },
  "mitii.autocomplete.temperature": {
    "type": "number",
    "description": "Autocomplete sampling temperature.",
    "default": 0.2,
    "minimum": 0,
    "maximum": 2
  },
  "mitii.semanticIndex.enabled": {
    "type": "boolean",
    "description": "Enable semantic workspace indexing. Bundled MiniLM works with any chat provider. HTTP embedding sources fail closed to lexical indexing if the probe fails.",
    "default": true
  },
  "mitii.semanticIndex.source": {
    "type": "string",
    "enum": [
      "bundled",
      "ollama",
      "openai-compatible",
      "disabled"
    ],
    "description": "Embedding source for semantic indexing. Bundled runs on-device MiniLM (native ONNX, WASM fallback). Ollama and OpenAI-compatible call an HTTP embeddings API. Disabled keeps lexical indexing only. LanceDB is the vector store, not a source.",
    "default": "bundled"
  },
  "mitii.semanticIndex.backend": {
    "type": "string",
    "enum": [
      "auto",
      "bundled",
      "openai-compatible",
      "ollama",
      "disabled"
    ],
    "description": "Deprecated alias for mitii.semanticIndex.source. Auto selects bundled MiniLM when no embedding model is set.",
    "default": "auto"
  },
  "mitii.semanticIndex.model": {
    "type": "string",
    "description": "Embedding model used for HTTP embedding sources. Ignored for bundled MiniLM. Empty uses the source preset, such as nomic-embed-text for Ollama.",
    "default": ""
  },
  "mitii.semanticIndex.dimensions": {
    "type": "number",
    "description": "Embedding vector dimensions for the semantic workspace index. Set 0 to use the backend preset/probe result. Changing this creates a distinct vector profile.",
    "default": 0,
    "minimum": 0
  },
  "mitii.semanticIndex.normalized": {
    "type": "boolean",
    "description": "Normalize embedding vectors before storing and querying the semantic workspace index. Changing this creates a distinct vector profile.",
    "default": true
  },
  "mitii.workspace.rootPathOverride": {
    "type": "string",
    "description": "Optional workspace root override used for indexing and agent runs",
    "default": ""
  },
  "mitii.workspace.maximumIndexFiles": {
    "type": "number",
    "description": "Maximum files to include in the workspace index. 0 uses the default (30,000). Raise up to 240,000 for very large repos. Ignore rules still skip build artifacts and secrets. Retrieval still scales from the model context window, not this file cap.",
    "default": 0,
    "minimum": 0,
    "maximum": 240000
  },
  "mitii.skills.workspace.enabled": {
    "type": "boolean",
    "description": "Load workspace-uploaded skills from .mitii/skills. Disable to run with only bundled/default skills.",
    "default": true
  },
  "mitii.ui.showReasoning": {
    "type": "boolean",
    "description": "Show live reasoning / thinking activity in the Mitii chat UI",
    "default": true
  },
  "mitii.ui.features.codeReviewButton": {
    "type": "boolean",
    "description": "Show the Code Review button on the working-tree bar. Review always lists git changes; Code Review runs an LLM analysis. Enable under Settings → Features.",
    "default": false
  },
  "mitii.ui.reasoningPreviewMaxChars": {
    "type": "number",
    "description": "Maximum characters retained in the reasoning preview stream",
    "default": 8000,
    "minimum": 500,
    "maximum": 50000
  },
  "mitii.ui.depth": {
    "type": "string",
    "enum": [
      "auto",
      "quick",
      "deep"
    ],
    "description": "Legacy global depth fallback. Prefer mitii.ui.modeDefaults.<mode>.thoroughness (or .depth when intensity overrides are on).",
    "default": "auto"
  },
  "mitii.ui.effort": {
    "type": "string",
    "enum": [
      "low",
      "medium",
      "high"
    ],
    "description": "Working-set overlay for model/tool/repair caps. Set by Thoroughness unless mitii.developer.intensityOverrides is on.",
    "default": "medium"
  },
  "mitii.ui.modeDefaults.ask.thoroughness": {
    "type": "string",
    "enum": [
      "low",
      "medium",
      "high"
    ],
    "description": "Ask-mode thoroughness (Low/Medium/High). Maps to exploration depth + working-set effort unless intensity overrides are on.",
    "default": "medium"
  },
  "mitii.ui.modeDefaults.ask.depth": {
    "type": "string",
    "enum": [
      "auto",
      "quick",
      "deep"
    ],
    "description": "Ask exploration depth. Driven by thoroughness unless Developer intensity overrides are enabled.",
    "default": "auto"
  },
  "mitii.ui.modeDefaults.ask.approvalMode": {
    "type": "string",
    "enum": [
      "safe",
      "guided",
      "pilot"
    ],
    "description": "Default approval mode for Ask mode",
    "default": "guided"
  },
  "mitii.ui.modeDefaults.ask.model": {
    "type": "string",
    "description": "Default model for Ask mode. Empty uses the active provider model.",
    "default": ""
  },
  "mitii.ui.modeDefaults.plan.thoroughness": {
    "type": "string",
    "enum": [
      "low",
      "medium",
      "high"
    ],
    "description": "Plan-mode thoroughness (Low/Medium/High). Maps to exploration depth + working-set effort unless intensity overrides are on.",
    "default": "high"
  },
  "mitii.ui.modeDefaults.plan.depth": {
    "type": "string",
    "enum": [
      "auto",
      "quick",
      "deep"
    ],
    "description": "Plan exploration depth. Driven by thoroughness unless Developer intensity overrides are enabled.",
    "default": "deep"
  },
  "mitii.ui.modeDefaults.plan.approvalMode": {
    "type": "string",
    "enum": [
      "safe",
      "guided",
      "pilot"
    ],
    "description": "Default approval mode for Plan mode",
    "default": "guided"
  },
  "mitii.ui.modeDefaults.plan.model": {
    "type": "string",
    "description": "Default model for Plan mode. Empty uses the active provider model.",
    "default": ""
  },
  "mitii.ui.modeDefaults.agent.thoroughness": {
    "type": "string",
    "enum": [
      "low",
      "medium",
      "high"
    ],
    "description": "Agent-mode thoroughness (Low/Medium/High). Maps to exploration depth + working-set effort unless intensity overrides are on.",
    "default": "medium"
  },
  "mitii.ui.modeDefaults.agent.depth": {
    "type": "string",
    "enum": [
      "auto",
      "quick",
      "deep"
    ],
    "description": "Agent exploration depth. Driven by thoroughness unless Developer intensity overrides are enabled.",
    "default": "auto"
  },
  "mitii.ui.modeDefaults.agent.approvalMode": {
    "type": "string",
    "enum": [
      "safe",
      "guided",
      "pilot"
    ],
    "description": "Default approval mode for Agent mode",
    "default": "safe"
  },
  "mitii.ui.modeDefaults.agent.model": {
    "type": "string",
    "description": "Default model for Agent mode. Empty uses the active provider model.",
    "default": ""
  },
  "mitii.agent.taskListAutoAdvance": {
    "type": "boolean",
    "description": "Product default ON: after a successful built-in mutating tool in Agent mode, mark matching checklist items done (by changed path) and activate the next pending change item. Unmatched mutations still advance the active item at most once per model turn. The SDK/engine library default remains off when hosts do not pass taskListAutoAdvance.",
    "default": true
  },
  "mitii.ui.contextToggles.repoMap": {
    "type": "boolean",
    "description": "Include repository map hints in agent context (also auto-enabled for deep / CI-git impact asks)",
    "default": false
  },
  "mitii.ui.contextToggles.diagnostics": {
    "type": "boolean",
    "description": "Include Problems diagnostics in agent context",
    "default": true
  },
  "mitii.ui.contextToggles.gitDiff": {
    "type": "boolean",
    "description": "Include git status/diff hints in agent context (also auto-enabled for deep / CI-git impact asks)",
    "default": false
  },
  "mitii.ui.contextToggles.editor": {
    "type": "boolean",
    "description": "Auto-include the active editor in agent context",
    "default": true
  },
  "mitii.ui.contextToggles.openTabs": {
    "type": "boolean",
    "description": "Include open editor tab paths in agent context",
    "default": false
  },
  "mitii.ui.contextToggles.memory": {
    "type": "boolean",
    "description": "Include session memory when available",
    "default": true
  },
  "mitii.scm.commitMessageStyle": {
    "type": "string",
    "enum": [
      "conventional",
      "plain"
    ],
    "description": "Style hint for generated commit messages. The Generate Commit Message command force-attaches the bundled git-commit-message skill.",
    "default": "conventional"
  },
  "mitii.safety.approvalMode": {
    "type": "string",
    "enum": [
      "safe",
      "guided",
      "builder",
      "pilot"
    ],
    "description": "Approval autonomy: safe (ask before mutations), guided (approve tool use automatically), pilot (full access including plan approval). Legacy builder maps to guided.",
    "default": "guided"
  },
  "mitii.safety.sandbox.enabled": {
    "type": "boolean",
    "description": "Enable OS process sandbox for run_command / process tools. When unset, defaults follow approval mode (safe/guided → on+deny; pilot → on+allow).",
    "default": null
  },
  "mitii.safety.sandbox.network": {
    "type": "string",
    "enum": [
      "deny",
      "allow"
    ],
    "description": "Outbound network for sandboxed children. When unset, follows approval-mode sandbox preset.",
    "default": null
  },
  "mitii.safety.sandbox.backend": {
    "type": "string",
    "enum": [
      "auto",
      "seatbelt",
      "bubblewrap",
      "docker",
      "podman"
    ],
    "description": "Preferred sandbox backend. auto picks seatbelt (macOS) or bubblewrap (Linux).",
    "default": "auto"
  },
  "mitii.tools.applyPatch.fuzzyMatch": {
    "type": "boolean",
    "description": "Allow bounded fuzzy recovery when apply_patch oldText is not found exactly (trim / indent / ±5 line window). Default off for first ship.",
    "default": false
  },
  "mitii.runBudget.unlimited": {
    "type": "boolean",
    "description": "Disable practical per-run model/tool/loop/wall-time caps for long-running local work. Provider quotas and machine limits still apply.",
    "default": false
  },
  "mitii.runBudget.maxModelCalls": {
    "type": "number",
    "description": "Maximum model calls allowed in one Mitii run before it stops with budget_exhausted.",
    "default": 64,
    "minimum": 1
  },
  "mitii.runBudget.maxToolCalls": {
    "type": "number",
    "description": "Maximum tool calls allowed in one Mitii run before it stops with budget_exhausted.",
    "default": 128,
    "minimum": 1
  },
  "mitii.runBudget.maxLoopIterations": {
    "type": "number",
    "description": "Maximum model/tool loop iterations allowed in one Mitii run before it stops with budget_exhausted.",
    "default": 96,
    "minimum": 1
  },
  "mitii.runBudget.maxWallTimeMinutes": {
    "type": "number",
    "description": "Maximum active wall-clock minutes allowed in one Mitii run. Time waiting for user approval is excluded by the engine.",
    "default": 30,
    "minimum": 1
  },
  "mitii.logVerbosity": {
    "type": "string",
    "enum": [
      "minimal",
      "standard",
      "verbose"
    ],
    "description": "How much diagnostic detail Mitii records in the run log, for finding bugs. Turn this down if the exported session log is too noisy.",
    "default": "verbose"
  },
  "mitii.onboarding.completed": {
    "type": "boolean",
    "description": "Whether first-run onboarding has been completed for this workspace",
    "default": false
  },
  "mitii.mcp": {
    "type": "object",
    "description": "MCP store install list (mirrored to .mitii/mcp.json). Off by default; add servers from the Settings store or as custom stdio/SSE/streamable-http entries. Deleting removes them from the install list.",
    "default": {
      "enabled": false,
      "servers": []
    }
  },
  "mitii.tokenBudget.visiblePlanMinUsableRatio": {
    "type": "number",
    "description": "Visible-plan affordability threshold as a fraction of the context window.",
    "default": 0.35,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.changeImpactMinUsableRatio": {
    "type": "number",
    "description": "Change-impact affordability threshold as a fraction of the context window.",
    "default": 0.35,
    "minimum": 0,
    "maximum": 1
  },
  "mitii.tokenBudget.maxPatchesPerCallCap": {
    "type": "number",
    "description": "Maximum patches allowed in one mutation call.",
    "default": 96,
    "minimum": 1
  },
  "mitii.loopPolicy.maxStructuredReviewRecoveries": {
    "type": "number",
    "description": "Recovery attempts when a structured review ends without findings (0 disables).",
    "default": 2,
    "minimum": 0,
    "maximum": 8
  }
};
