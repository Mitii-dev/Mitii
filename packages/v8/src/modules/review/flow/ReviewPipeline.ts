import {
  REVIEW_MESSAGES,
  REVIEW_REASON,
  REVIEW_SCHEMA_VERSION,
  REVIEW_STAGES,
} from "../constants";
import {
  ReviewError,
  reviewInputSchema,
  reviewPrepResultSchema,
  reviewPreviewSchema,
  reviewResultSchema,
  noopModuleLogger,
} from "../contracts";
import type {
  ModuleLoggerPort,
  ReviewFinding,
  ReviewLlmPort,
  ReviewParsedInput,
  ReviewPrepResult,
  ReviewPreview,
  ReviewRecord,
  ReviewRecordStorePort,
  ReviewResult,
} from "../contracts";
import { selectReviewFiles } from "./steps/1-select-files";
import { groupReviewFiles } from "./steps/2-group-files";
import { resolveReviewRules } from "./steps/3-resolve-rules";
import { repairFindingArgs } from "./steps/4-repair-findings";
import { anchorFindings } from "./steps/5-anchor-findings";
import { reflectFindings } from "./steps/6-reflect-findings";
import { buildReviewRecord } from "./steps/7-build-record";
import { exportSarif, type SarifReport } from "./steps/8-export-sarif";
import { findingFingerprint } from "../helpers/pathUtils";
import { effortToRounds } from "../rules";

export interface ReviewPipelineDependencies {
  records?: ReviewRecordStorePort;
  llm?: ReviewLlmPort;
  log?: ModuleLoggerPort;
  idGenerator?: () => string;
  clock?: () => Date;
}

/**
 * Deterministic review prep + finding post-process facade.
 * Does not own mutation, verification checks, or model tool loops.
 *
 * Flow:
 *   preview → 1-select-files
 *   prepare → 1-select-files → 2-group-files → 3-resolve-rules
 *   finalize → 4-repair → 5-anchor → 6-reflect → 7-build-record
 *   toSarif → 8-export-sarif
 */
export class ReviewPipeline {
  private readonly records?: ReviewRecordStorePort;
  private readonly llm?: ReviewLlmPort;
  private readonly log: ModuleLoggerPort;
  private readonly idGenerator: () => string;
  private readonly clock: () => Date;

  constructor(deps: ReviewPipelineDependencies = {}) {
    this.records = deps.records;
    this.llm = deps.llm;
    this.log = deps.log ?? noopModuleLogger;
    this.idGenerator =
      deps.idGenerator ??
      (() =>
        `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
    this.clock = deps.clock ?? (() => new Date());
  }

  public preview(input: ReviewParsedInput | unknown): ReviewPreview {
    const parsed = this.parseInput(input);
    let stageStartedMs = Date.now();
    const selection = selectReviewFiles(parsed);
    const reasonCodes = [
      selection.selectedCount > 0
        ? REVIEW_REASON.preview
        : REVIEW_REASON.noReviewableFiles,
    ];
    this.log.stage({
      module: "review",
      stage: REVIEW_STAGES.selectFiles,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes,
      outputSummary: {
        selectedCount: selection.selectedCount,
        excludedCount: selection.excludedCount,
      },
    });
    return reviewPreviewSchema.parse({
      schemaVersion: REVIEW_SCHEMA_VERSION,
      status: "preview",
      mode: parsed.mode,
      effort: parsed.effort,
      files: selection.decisions,
      selectedCount: selection.selectedCount,
      excludedCount: selection.excludedCount,
      totalInsertions: selection.totalInsertions,
      totalDeletions: selection.totalDeletions,
      reasonCodes,
      warnings: [],
    });
  }

  public prepare(input: ReviewParsedInput | unknown): ReviewPrepResult {
    const parsed = this.parseInput(input);

    let stageStartedMs = Date.now();
    const selection = selectReviewFiles(parsed);
    this.log.stage({
      module: "review",
      stage: REVIEW_STAGES.selectFiles,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [
        selection.selectedCount > 0
          ? REVIEW_REASON.prepared
          : REVIEW_REASON.noReviewableFiles,
      ],
      outputSummary: {
        selectedCount: selection.selectedCount,
        excludedCount: selection.excludedCount,
      },
    });

    stageStartedMs = Date.now();
    const { groups, warnings: groupWarnings } = groupReviewFiles({
      selected: selection.selected,
      input: parsed,
    });
    this.log.stage({
      module: "review",
      stage: REVIEW_STAGES.groupFiles,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [REVIEW_REASON.groupsFormed],
      outputSummary: { groupCount: groups.length },
    });

    stageStartedMs = Date.now();
    const selectedPaths = selection.selected.map((f) => f.path);
    const { rules, ruleGroups, warnings: ruleWarnings } = resolveReviewRules({
      paths: selectedPaths,
      input: parsed,
    });
    this.log.stage({
      module: "review",
      stage: REVIEW_STAGES.resolveRules,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [REVIEW_REASON.rulesResolved],
      outputSummary: {
        ruleCount: rules.length,
        ruleGroupCount: ruleGroups.length,
      },
    });

    const reasonCodes: ReviewPrepResult["reasonCodes"] = [];
    if (selection.selectedCount === 0) {
      reasonCodes.push(REVIEW_REASON.noReviewableFiles);
    } else {
      reasonCodes.push(REVIEW_REASON.prepared);
      reasonCodes.push(REVIEW_REASON.groupsFormed);
      reasonCodes.push(REVIEW_REASON.rulesResolved);
    }
    if (parsed.mode === "scan" && groups.length > 0) {
      reasonCodes.push(REVIEW_REASON.scanBatched);
    }

    const status =
      selection.selectedCount === 0
        ? "empty"
        : groupWarnings.length > 0 || ruleWarnings.length > 0
          ? "partial"
          : "ok";

    return reviewPrepResultSchema.parse({
      schemaVersion: REVIEW_SCHEMA_VERSION,
      status,
      mode: parsed.mode,
      effort: parsed.effort,
      maxReviewRounds: effortToRounds(parsed.effort),
      files: selection.decisions,
      groups,
      rules,
      ruleGroups,
      selectedCount: selection.selectedCount,
      excludedCount: selection.excludedCount,
      reasonCodes,
      warnings: [...groupWarnings, ...ruleWarnings],
      background: parsed.background,
    });
  }

  public async finalize(params: {
    input: ReviewParsedInput | unknown;
    rawFindings?: unknown;
    findings?: readonly ReviewFinding[];
    prep?: ReviewPrepResult;
    persist?: boolean;
  }): Promise<ReviewResult> {
    const parsed = this.parseInput(params.input);
    const prep = params.prep ?? this.prepare(parsed);

    let stageStartedMs = Date.now();
    const repaired = params.findings
      ? {
          findings: [...params.findings],
          warnings: [] as ReviewResult["warnings"],
        }
      : repairFindingArgs(params.rawFindings ?? []);
    this.log.stage({
      module: "review",
      stage: REVIEW_STAGES.repairFindings,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: { findingCount: repaired.findings.length },
    });

    const capped = repaired.findings.slice(0, parsed.maxFindings);
    if (repaired.findings.length > capped.length) {
      repaired.warnings.push({
        code: "finding_truncated",
        message: REVIEW_MESSAGES.findingsTruncated(parsed.maxFindings),
      });
    }

    stageStartedMs = Date.now();
    const anchored = anchorFindings({
      findings: capped,
      files: parsed.files,
    });
    this.log.stage({
      module: "review",
      stage: REVIEW_STAGES.anchorFindings,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        findingCount: anchored.findings.length,
        warningCount: anchored.warnings.length,
      },
    });

    stageStartedMs = Date.now();
    const reflected = await reflectFindings({
      findings: anchored.findings,
      files: parsed.files,
      llm: this.llm,
    });
    this.log.stage({
      module: "review",
      stage: REVIEW_STAGES.reflectFindings,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        findingCount: reflected.findings.length,
        warningCount: reflected.warnings.length,
      },
    });

    const findings = reflected.findings.map((f, index) => ({
      ...f,
      findingId:
        f.findingId ??
        findingFingerprint({
          path: f.path,
          startLine: f.startLine,
          content: f.content,
          existingCode: f.existingCode,
        }) + `_${index}`,
    }));

    const anchoredCount = findings.filter((f) => f.anchored).length;
    const reasonCodes: ReviewResult["reasonCodes"] = [];
    if (findings.length === 0 && prep.selectedCount === 0) {
      reasonCodes.push(REVIEW_REASON.noReviewableFiles);
    } else {
      reasonCodes.push(REVIEW_REASON.complete);
    }
    if (anchoredCount > 0) reasonCodes.push(REVIEW_REASON.findingsAnchored);
    if (findings.some((f) => !f.anchored)) {
      reasonCodes.push(REVIEW_REASON.findingsUnanchored);
    }
    if (
      repaired.warnings.length > 0 ||
      anchored.warnings.length > 0 ||
      reflected.warnings.length > 0
    ) {
      reasonCodes.push(REVIEW_REASON.partial);
    }

    const status =
      reasonCodes.includes(REVIEW_REASON.partial) || prep.status === "partial"
        ? "partial"
        : findings.length === 0 && prep.selectedCount === 0
          ? "empty"
          : "ok";

    const userSummary = summarizeFindings(findings);

    let recordId: string | undefined;
    const result = reviewResultSchema.parse({
      schemaVersion: REVIEW_SCHEMA_VERSION,
      status,
      mode: parsed.mode,
      effort: parsed.effort,
      files: prep.files,
      groups: prep.groups,
      findings,
      selectedCount: prep.selectedCount,
      excludedCount: prep.excludedCount,
      findingCount: findings.length,
      anchoredCount,
      userSummary,
      reasonCodes: [...new Set(reasonCodes)],
      warnings: [
        ...prep.warnings,
        ...repaired.warnings,
        ...anchored.warnings,
        ...reflected.warnings,
      ],
      recordId,
    });

    if (params.persist !== false && this.records) {
      stageStartedMs = Date.now();
      recordId = this.idGenerator();
      const record = buildReviewRecord({
        input: parsed,
        prep,
        result: { ...result, recordId },
        recordId,
        status:
          status === "ok"
            ? "complete"
            : status === "empty"
              ? "complete"
              : "partial",
        now: this.clock(),
      });
      await this.records.save(record);
      this.log.stage({
        module: "review",
        stage: REVIEW_STAGES.buildRecord,
        durationMs: Date.now() - stageStartedMs,
        reasonCodes: [REVIEW_REASON.complete],
        outputSummary: { recordId },
      });
      return { ...result, recordId };
    }

    return result;
  }

  public toSarif(result: ReviewResult): SarifReport {
    return exportSarif({ result });
  }

  public async persistRecord(record: ReviewRecord): Promise<void> {
    if (!this.records) {
      throw new ReviewError(
        "misconfigured",
        REVIEW_MESSAGES.storeRequired,
      );
    }
    await this.records.save(record);
  }

  public async loadLatest(
    workspaceId: string,
  ): Promise<ReviewRecord | undefined> {
    if (!this.records) {
      throw new ReviewError(
        "misconfigured",
        REVIEW_MESSAGES.storeRequired,
      );
    }
    return this.records.loadLatest(workspaceId);
  }

  public async loadRecord(
    recordId: string,
  ): Promise<ReviewRecord | undefined> {
    if (!this.records) {
      throw new ReviewError(
        "misconfigured",
        REVIEW_MESSAGES.storeRequired,
      );
    }
    return this.records.load(recordId);
  }

  private parseInput(input: unknown): ReviewParsedInput {
    try {
      return reviewInputSchema.parse(input);
    } catch (error) {
      throw new ReviewError(
        "invalid_input",
        REVIEW_MESSAGES.inputInvalid,
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}

function summarizeFindings(findings: readonly ReviewFinding[]): string {
  if (findings.length === 0) {
    return REVIEW_MESSAGES.noFindings;
  }
  const bySeverity = new Map<string, number>();
  for (const f of findings) {
    bySeverity.set(f.severity, (bySeverity.get(f.severity) ?? 0) + 1);
  }
  const parts = [...bySeverity.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([sev, n]) => `${n} ${sev}`);
  return `${findings.length} finding(s): ${parts.join(", ")}.`;
}
