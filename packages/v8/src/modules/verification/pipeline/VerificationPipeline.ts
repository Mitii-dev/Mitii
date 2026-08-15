import {
  discoverApplicableChecks,
  captureRepoBuildState,
  compareRepoBuildStates,
  executeChecks,
  inspectDiffAndStaleRisk,
  mapAffectedProjects,
  normalizeDiagnostics,
  recommendCompletion,
  selectProportionalChecks,
} from "../actions";
import {
  VerificationError,
  verificationInputSchema,
  verificationResultSchema,
} from "../contracts";
import type {
  VerificationInput,
  VerificationManifestReaderPort,
  VerificationReasonCode,
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationResult,
  VerificationToolExecutorPort,
} from "../contracts";
import { VERIFICATION_SCHEMA_VERSION } from "../constants";

export interface VerificationPipelineOptions {
  signal?: AbortSignal;
}

export interface VerificationPipelineDependencies {
  tools: VerificationToolExecutorPort;
  manifests: VerificationManifestReaderPort;
}

/**
 * Verification facade.
 *
 * Flow:
 *   validate input
 *   → map changed files to projects
 *   → discover checks from trusted manifests
 *   → select proportionally
 *   → execute via Tool Runtime
 *   → normalize diagnostics
 *   → inspect diff / stale-state risk
 *   → recommend completion status from evidence only
 */
export class VerificationPipeline {
  private readonly tools: VerificationToolExecutorPort;
  private readonly manifests: VerificationManifestReaderPort;

  constructor(dependencies: VerificationPipelineDependencies) {
    if (!dependencies.tools || !dependencies.manifests) {
      throw new VerificationError(
        "misconfigured_ports",
        "VerificationPipeline requires tools and manifests ports.",
      );
    }
    this.tools = dependencies.tools;
    this.manifests = dependencies.manifests;
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
        "Verification input failed schema validation.",
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
          summary: "Pinned repository state is unavailable.",
          changedPaths: [...parsed.changedFiles],
        },
        warnings: ["Pinned repository state is unavailable."],
        reasonCodes: ["state_unavailable"],
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
          summary: "Verification was not required by Decision Policy.",
          changedPaths: [...parsed.changedFiles],
        },
        warnings: [],
        reasonCodes: ["verification_not_required"],
        durationMs: Date.now() - startedMs,
      });
    }

    const mapping = mapAffectedProjects({
      changedFiles: parsed.changedFiles,
      projects: parsed.projects,
      changeScope: parsed.changeScope,
    });

    const discovered = await discoverApplicableChecks({
      projects: mapping.projects,
      changeScope: parsed.changeScope,
      changedFiles: parsed.changedFiles,
      manifests: this.manifests,
    });

    const selected = selectProportionalChecks({
      candidates: discovered.candidates,
      verification: parsed.verification,
      changeScope: parsed.changeScope,
    });

    const executed = await executeChecks({
      candidates: selected.selected,
      grant: parsed.grant,
      workspaceRoot: parsed.workspaceRoot,
      pinnedState: parsed.pinnedState,
      tools: this.tools,
      signal: options.signal,
    });

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

    const recommendation = recommendCompletion({
      verification: parsed.verification,
      checks: executed.checks,
      cancelled: executed.cancelled || Boolean(options.signal?.aborted),
      staleStateRisk: inspection.diff.staleStateRisk,
      stateUnavailable: false,
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
      warnings.push(
        `Omitted ${selected.omitted.length} lower-priority check candidate(s) for proportional scope.`,
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
  }): RepoBuildStateComparison {
    return compareRepoBuildStates(params);
  }
}

function uniqueReasonCodes(
  codes: readonly VerificationReasonCode[],
): VerificationReasonCode[] {
  return [...new Set(codes)];
}
