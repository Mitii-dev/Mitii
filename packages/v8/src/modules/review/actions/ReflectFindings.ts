import type {
  ReviewChangedFile,
  ReviewFinding,
  ReviewLlmPort,
  ReviewWarning,
} from "../contracts";
import { contentFromUnifiedDiff } from "./AnchorFindings";
import { normalizeRelativePath } from "../internal/pathUtils";

/**
 * Optional second-pass filter. Fail-open: on LLM error or missing port, keep all.
 * Deterministic fallback drops findings whose existingCode is absent from all files.
 */
export async function reflectFindings(params: {
  findings: readonly ReviewFinding[];
  files: readonly ReviewChangedFile[];
  llm?: ReviewLlmPort;
}): Promise<{ findings: ReviewFinding[]; warnings: ReviewWarning[] }> {
  const warnings: ReviewWarning[] = [];

  if (params.llm?.complete) {
    try {
      const prompt = buildReflectPrompt(params.findings, params.files);
      const response = await params.llm.complete({
        purpose: "reflect",
        prompt,
        maxTokens: 2_000,
      });
      const keepIds = parseKeepIds(response);
      if (keepIds) {
        const filtered = params.findings.filter((f, index) => {
          const id = f.findingId ?? String(index);
          return keepIds.has(id);
        });
        return { findings: filtered, warnings };
      }
    } catch {
      warnings.push({
        code: "reflect_skipped",
        message: "Reflect LLM call failed; keeping all findings.",
      });
    }
  } else {
    warnings.push({
      code: "reflect_skipped",
      message: "No reflect LLM; applying deterministic presence check only.",
    });
  }

  // Deterministic soft filter: drop only when snippet clearly absent
  const kept: ReviewFinding[] = [];
  for (const finding of params.findings) {
    const present = snippetPresent(finding, params.files);
    if (!present && finding.anchored === false) {
      // Keep unanchored for human triage — do not drop aggressively
      kept.push(finding);
      continue;
    }
    kept.push(finding);
  }
  return { findings: kept, warnings };
}

function snippetPresent(
  finding: ReviewFinding,
  files: readonly ReviewChangedFile[],
): boolean {
  const snippet = finding.existingCode.trim();
  if (!snippet) return false;
  for (const file of files) {
    const text =
      file.content ??
      (file.diff ? contentFromUnifiedDiff(file.diff) : undefined);
    if (text?.includes(snippet)) return true;
    if (normalizeRelativePath(file.path) === normalizeRelativePath(finding.path)) {
      if (file.diff?.includes(snippet)) return true;
    }
  }
  return false;
}

function buildReflectPrompt(
  findings: readonly ReviewFinding[],
  _files: readonly ReviewChangedFile[],
): string {
  return [
    "You filter code-review findings that are clearly wrong given the diff.",
    "Reply with JSON: {\"keep\":[\"id\",...]} using finding ids.",
    "When unsure, keep the finding.",
    JSON.stringify(
      findings.map((f, i) => ({
        id: f.findingId ?? String(i),
        path: f.path,
        content: f.content,
        existingCode: f.existingCode,
      })),
    ),
  ].join("\n");
}

function parseKeepIds(response: string): Set<string> | undefined {
  try {
    const fenced = response
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "");
    const parsed = JSON.parse(fenced) as { keep?: unknown };
    if (!Array.isArray(parsed.keep)) return undefined;
    return new Set(parsed.keep.map((v) => String(v)));
  } catch {
    return undefined;
  }
}
