import { REVIEW_SCHEMA_VERSION } from "../constants";
import {
  ReviewError,
  reviewInputSchema,
  reviewPrepResultSchema,
  reviewPreviewSchema,
  reviewResultSchema,
} from "../contracts";
import type {
  ReviewFinding,
  ReviewLlmPort,
  ReviewParsedInput,
  ReviewPrepResult,
  ReviewPreview,
  ReviewRecord,
  ReviewRecordStorePort,
  ReviewResult,
} from "../contracts";
import { selectReviewFiles } from "../actions/SelectReviewFiles";
import { groupReviewFiles } from "../actions/GroupReviewFiles";
import { resolveReviewRules } from "../actions/ResolveReviewRules";
import { repairFindingArgs } from "../actions/RepairFindingArgs";
import { anchorFindings } from "../actions/AnchorFindings";
import { reflectFindings } from "../actions/ReflectFindings";
import { buildReviewRecord } from "../actions/BuildReviewRecord";
import { exportSarif, type SarifReport } from "../actions/ExportSarif";
import { findingFingerprint } from "../internal/pathUtils";
import { effortToRounds } from "../policy";

export interface ReviewPipelineDependencies {
  records?: ReviewRecordStorePort;
  llm?: ReviewLlmPort;
  idGenerator?: () => string;
  clock?: () => Date;
}

/**
 * Deterministic review prep + finding post-process facade.
 * Does not own mutation, verification checks, or model tool loops.
 */
export class ReviewPipeline {
  private readonly records?: ReviewRecordStorePort;
  private readonly llm?: ReviewLlmPort;
  private readonly idGenerator: () => string;
  private readonly clock: () => Date;

  constructor(deps: ReviewPipelineDependencies = {}) {
    this.records = deps.records;
    this.llm = deps.llm;
    this.idGenerator =
      deps.idGenerator ??
      (() => `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
    this.clock = deps.clock ?? (() => new Date());
  }

  public preview(input: ReviewParsedInput | unknown): ReviewPreview {
    const parsed = this.parseInput(input);
    const selection = selectReviewFiles(parsed);
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
      reasonCodes: [
        selection.selectedCount > 0 ? "review_preview" : "no_reviewable_files",
      ],
      warnings: [],
    });
  }

  public prepare(input: ReviewParsedInput | unknown): ReviewPrepResult {
    const parsed = this.parseInput(input);
    const selection = selectReviewFiles(parsed);
    const { groups, warnings: groupWarnings } = groupReviewFiles({
      selected: selection.selected,
      input: parsed,
    });
    const selectedPaths = selection.selected.map((f) => f.path);
    const { rules, ruleGroups, warnings: ruleWarnings } = resolveReviewRules({
      paths: selectedPaths,
      input: parsed,
    });

    const reasonCodes: ReviewPrepResult["reasonCodes"] = [];
    if (selection.selectedCount === 0) {
      reasonCodes.push("no_reviewable_files");
    } else {
      reasonCodes.push("review_prepared");
      reasonCodes.push("groups_formed");
      reasonCodes.push("rules_resolved");
    }
    if (parsed.mode === "scan" && groups.length > 0) {
      reasonCodes.push("scan_batched");
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
    const repaired = params.findings
      ? { findings: [...params.findings], warnings: [] as ReviewResult["warnings"] }
      : repairFindingArgs(params.rawFindings ?? []);

    const capped = repaired.findings.slice(0, parsed.maxFindings);
    if (repaired.findings.length > capped.length) {
      repaired.warnings.push({
        code: "finding_truncated",
        message: `Truncated findings to maxFindings=${parsed.maxFindings}.`,
      });
    }

    const anchored = anchorFindings({
      findings: capped,
      files: parsed.files,
    });

    const reflected = await reflectFindings({
      findings: anchored.findings,
      files: parsed.files,
      llm: this.llm,
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
      reasonCodes.push("no_reviewable_files");
    } else if (findings.length === 0) {
      reasonCodes.push("review_complete");
    } else {
      reasonCodes.push("review_complete");
    }
    if (anchoredCount > 0) reasonCodes.push("findings_anchored");
    if (findings.some((f) => !f.anchored)) reasonCodes.push("findings_unanchored");
    if (
      repaired.warnings.length > 0 ||
      anchored.warnings.length > 0 ||
      reflected.warnings.length > 0
    ) {
      reasonCodes.push("review_partial");
    }

    const status =
      reasonCodes.includes("review_partial") || prep.status === "partial"
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
      recordId = this.idGenerator();
      const record = buildReviewRecord({
        input: parsed,
        prep,
        result: { ...result, recordId },
        recordId,
        status: status === "ok" ? "complete" : status === "empty" ? "complete" : "partial",
        now: this.clock(),
      });
      await this.records.save(record);
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
        "ReviewPipeline has no ReviewRecordStorePort.",
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
        "ReviewPipeline has no ReviewRecordStorePort.",
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
        "ReviewPipeline has no ReviewRecordStorePort.",
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
        "Review input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}

function summarizeFindings(findings: readonly ReviewFinding[]): string {
  if (findings.length === 0) {
    return "No review findings.";
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
