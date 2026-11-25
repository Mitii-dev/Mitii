import {
  discoverApplicableChecks,
  buildVerificationRecord,
  buildVerificationUserSummary,
  captureRepoBuildState,
  compareRepoBuildStates,
  executeChecks,
  inspectDiffAndStaleRisk,
  mapAffectedProjects,
  normalizeDiagnostics,
  recommendCompletion,
  selectProportionalChecks,
} from "./steps";
import type { BuildVerificationRecordParams } from "./steps";
import {
  VERIFICATION_MESSAGES,
  VERIFICATION_REASON,
  VERIFICATION_SCHEMA_VERSION,
  VERIFICATION_STAGES,
} from "../constants";
import {
  VerificationError,
  verificationInputSchema,
  verificationRecordSchema,
  verificationResultSchema,
  noopModuleLogger,
} from "../contracts";
import type {
  ModuleLoggerPort,
  VerificationInput,
  VerificationManifestReaderPort,
  VerificationReasonCode,
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationRecord,
  VerificationRecordStorePort,
  VerificationResult,
  VerificationSyntaxPort,
  VerificationToolExecutorPort,
} from "../contracts";

export interface VerificationPipelineOptions {
  signal?: AbortSignal;
}

export interface VerificationPipelineDependencies {
  tools: VerificationToolExecutorPort;
  manifests: VerificationManifestReaderPort;
  /** Optional durable store. Omit in tests that only exercise check execution. */
  records?: VerificationRecordStorePort;
  /** Optional host tree-sitter syntax gate (ERROR / missing nodes). */
  syntax?: VerificationSyntaxPort;
  log?: ModuleLoggerPort;
}

/**
 * Verification facade.
 *
 * Flow (verify):
 *   1-map-affected-projects → 2-discover-checks → 3-select-checks
 *   → 4-execute-checks → 5-normalize-diagnostics → 6-inspect-diff
 *   → 7-recommend-completion
 */
export class VerificationPipeline {
  private readonly tools: VerificationToolExecutorPort;
  private readonly manifests: VerificationManifestReaderPort;
  private readonly records?: VerificationRecordStorePort;
  private readonly syntax?: VerificationSyntaxPort;
  private readonly log: ModuleLoggerPort;

  constructor(dependencies: VerificationPipelineDependencies) {
    if (!dependencies.tools || !dependencies.manifests) {
      throw new VerificationError(
        "misconfigured_ports",
        VERIFICATION_MESSAGES.portsRequired,
      );
    }
    this.tools = dependencies.tools;
    this.manifests = dependencies.manifests;
    this.records = dependencies.records;
    this.syntax = dependencies.syntax;
    this.log = dependencies.log ?? noopModuleLogger;
  }

  public async verify(
    input: VerificationInput,
    options: VerificationPipelineOptions = {},
  ): Promise<VerificationResult> {
    const startedMs = Date.now();

    let parsed: VerificationInput;
    try {
      parsed = verificationInputSchema.parse(input);
    } catch (error) {
      throw new VerificationError(
        "invalid_input",
        VERIFICATION_MESSAGES.inputInvalid,
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    if (parsed.stateReadiness === "unavailable") {
      return verificationResultSchema.parse({
        schemaVersion: VERIFICATION_SCHEMA_VERSION,
        status: "blocked",
        stateToken: parsed.pinnedState.stateToken,
        affectedProjectIds: [],
        checks: [],
        diagnostics: [],
        diff: {
          reviewed: false,
          staleStateRisk: true,
          summary: VERIFICATION_MESSAGES.stateUnavailable,
          changedPaths: [...parsed.changedFiles],
        },
        warnings: [VERIFICATION_MESSAGES.stateUnavailable],
        reasonCodes: [VERIFICATION_REASON.stateUnavailable],
        durationMs: Date.now() - startedMs,
      });
    }

    if (!parsed.verification.required) {
      return verificationResultSchema.parse({
        schemaVersion: VERIFICATION_SCHEMA_VERSION,
        status: "verified_success",
        stateToken: parsed.pinnedState.stateToken,
        affectedProjectIds: [],
        checks: [],
        diagnostics: [],
        diff: {
          reviewed: false,
          staleStateRisk: parsed.stateReadiness !== "ready",
          summary: VERIFICATION_MESSAGES.notRequired,
          changedPaths: [...parsed.changedFiles],
        },
        warnings: [],
        reasonCodes: [VERIFICATION_REASON.notRequired],
        durationMs: Date.now() - startedMs,
      });
    }

    let stageStartedMs = Date.now();
    const mapping = mapAffectedProjects({
      changedFiles: parsed.changedFiles,
      projects: parsed.projects,
      changeScope: parsed.changeScope,
    });
    this.log.stage({
      module: "verification",
      stage: VERIFICATION_STAGES.mapAffectedProjects,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: mapping.reasonCodes,
      outputSummary: { projectCount: mapping.projects.length },
    });

    stageStartedMs = Date.now();
    const discovered = await discoverApplicableChecks({
      projects: mapping.projects,
      changeScope: parsed.changeScope,
      changedFiles: parsed.changedFiles,
      manifests: this.manifests,
      syntaxPortAvailable: Boolean(this.syntax),
    });
    this.log.stage({
      module: "verification",
      stage: VERIFICATION_STAGES.discoverChecks,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        candidateCount: discovered.candidates.length,
        warningCount: discovered.warnings.length,
      },
    });

    stageStartedMs = Date.now();
    const selected = selectProportionalChecks({
      candidates: discovered.candidates,
      verification: parsed.verification,
      changeScope: parsed.changeScope,
      maxChecks: parsed.maxChecks,
      changedFiles: parsed.changedFiles,
      scriptHints: discovered.scriptHints,
      ...(typeof parsed.widenScope === "boolean"
        ? { widenScope: parsed.widenScope }
        : {}),
      ...(parsed.impactAffectedFiles
        ? { impactAffectedFiles: parsed.impactAffectedFiles }
        : {}),
    });
    this.log.stage({
      module: "verification",
      stage: VERIFICATION_STAGES.selectChecks,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        selectedCount: selected.selected.length,
        omittedCount: selected.omitted.length,
      },
    });

    stageStartedMs = Date.now();
    const executed = await executeChecks({
      candidates: selected.selected,
      grant: parsed.grant,
      workspaceRoot: parsed.workspaceRoot,
      pinnedState: parsed.pinnedState,
      tools: this.tools,
      ...(this.syntax ? { syntax: this.syntax } : {}),
      signal: options.signal,
    });
    this.log.stage({
      module: "verification",
      stage: VERIFICATION_STAGES.executeChecks,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        checkCount: executed.checks.length,
        cancelled: executed.cancelled,
        warningCount: executed.warnings.length,
      },
    });

    stageStartedMs = Date.now();
    const allDiagnostics = normalizeDiagnostics({
      checks: executed.checks,
      toolOutputs: executed.toolOutputs,
      projects: parsed.projects,
    });
    const diagnostics = normalizeDiagnostics({
      checks: executed.checks,
      toolOutputs: executed.toolOutputs,
      projects: parsed.projects,
      baselineDiagnostics: parsed.baselineDiagnostics,
    });
    this.log.stage({
      module: "verification",
      stage: VERIFICATION_STAGES.normalizeDiagnostics,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        diagnosticCount: diagnostics.length,
        allDiagnosticCount: allDiagnostics.length,
      },
    });

    stageStartedMs = Date.now();
    const inspection = await inspectDiffAndStaleRisk({
      changedFiles: parsed.changedFiles,
      stateReadiness: parsed.stateReadiness,
      checks: executed.checks,
      toolOutputs: executed.toolOutputs,
      grant: parsed.grant,
      workspaceRoot: parsed.workspaceRoot,
      pinnedState: parsed.pinnedState,
      tools: this.tools,
      signal: options.signal,
    });
    this.log.stage({
      module: "verification",
      stage: VERIFICATION_STAGES.inspectDiff,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        reviewed: inspection.diff.reviewed,
        staleStateRisk: inspection.diff.staleStateRisk,
      },
    });

    stageStartedMs = Date.now();
    const recommendation = recommendCompletion({
      verification: parsed.verification,
      checks: executed.checks,
      cancelled: executed.cancelled || Boolean(options.signal?.aborted),
      staleStateRisk: inspection.diff.staleStateRisk,
      stateUnavailable: false,
      diagnostics: allDiagnostics,
      changedFiles: parsed.changedFiles,
      askScopePaths: parsed.changedFiles,
    });
    this.log.stage({
      module: "verification",
      stage: VERIFICATION_STAGES.recommendCompletion,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: recommendation.reasonCodes,
      outputSummary: { status: recommendation.status },
    });

    const reasonCodes = uniqueReasonCodes([
      ...mapping.reasonCodes,
      ...recommendation.reasonCodes,
    ]);

    const warnings = [
      ...discovered.warnings,
      ...executed.warnings,
      ...(inspection.warning ? [inspection.warning] : []),
    ];

    if (selected.omitted.length > 0) {
      warnings.push(VERIFICATION_MESSAGES.omittedChecks(selected.omitted.length));
    }

    const failedChecksWithoutDiagnostics = executed.checks.filter(
      (check) => check.outcome === "failed",
    );
    if (failedChecksWithoutDiagnostics.length > 0 && allDiagnostics.length === 0) {
      warnings.push(
        VERIFICATION_MESSAGES.failedWithoutDiagnostics(
          failedChecksWithoutDiagnostics.length,
          failedChecksWithoutDiagnostics
            .map((check) => check.checkId)
            .slice(0, 5)
            .join(", "),
        ),
      );
    }

    return verificationResultSchema.parse({
      schemaVersion: VERIFICATION_SCHEMA_VERSION,
      status: recommendation.status,
      stateToken: parsed.pinnedState.stateToken,
      affectedProjectIds: mapping.projects.map((project) => project.projectId),
      checks: executed.checks,
      diagnostics,
      allDiagnostics,
      diff: inspection.diff,
      warnings,
      reasonCodes,
      durationMs: Date.now() - startedMs,
    });
  }

  public async captureBuildState(
    input: VerificationInput,
    params: { phase: "before" | "after"; capturedAt?: string },
    options: VerificationPipelineOptions = {},
  ): Promise<RepoBuildState> {
    const result = await this.verify(input, options);
    return captureRepoBuildState({
      phase: params.phase,
      input,
      result,
      capturedAt: params.capturedAt,
    });
  }

  public buildStateFromResult(
    input: VerificationInput,
    result: VerificationResult,
    params: { phase: "before" | "after"; capturedAt?: string },
  ): RepoBuildState {
    return captureRepoBuildState({
      phase: params.phase,
      input,
      result,
      capturedAt: params.capturedAt,
    });
  }

  public compareBuildStates(params: {
    before?: RepoBuildState;
    after: RepoBuildState;
    askScopePaths?: readonly string[];
    changedFiles?: readonly string[];
  }): RepoBuildStateComparison {
    return compareRepoBuildStates(params);
  }

  public buildRecord(
    params: BuildVerificationRecordParams,
  ): VerificationRecord {
    return buildVerificationRecord(params);
  }

  public buildUserSummary(record: VerificationRecord): string {
    return buildVerificationUserSummary(record);
  }

  public async persistRecord(record: VerificationRecord): Promise<void> {
    if (!this.records) {
      return;
    }
    const parsed = verificationRecordSchema.parse(record);
    try {
      await this.records.save(parsed);
    } catch (error) {
      throw new VerificationError(
        "store_failed",
        VERIFICATION_MESSAGES.storeFailed,
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  public async loadRecord(
    recordId: string,
  ): Promise<VerificationRecord | undefined> {
    if (!this.records) {
      return undefined;
    }
    return this.records.load(recordId);
  }

  public async loadLatestRecord(
    workspaceId: string,
  ): Promise<VerificationRecord | undefined> {
    if (!this.records || workspaceId.trim().length === 0) {
      return undefined;
    }
    return this.records.loadLatest(workspaceId);
  }
}

function uniqueReasonCodes(
  codes: readonly VerificationReasonCode[],
): VerificationReasonCode[] {
  return [...new Set(codes)];
}
