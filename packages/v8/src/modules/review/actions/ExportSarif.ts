import {
  REVIEW_SARIF_FINGERPRINT_KEY,
  REVIEW_SARIF_INFORMATION_URI,
  REVIEW_SARIF_TOOL_NAME,
} from "../constants";
import type { ReviewFinding, ReviewResult } from "../contracts";
import { findingFingerprint } from "../internal/pathUtils";

export interface SarifReport {
  $schema: string;
  version: "2.1.0";
  runs: Array<{
    tool: {
      driver: {
        name: string;
        informationUri: string;
        rules: Array<{
          id: string;
          name: string;
          shortDescription: { text: string };
        }>;
      };
    };
    results: Array<{
      ruleId: string;
      level: "error" | "warning" | "note" | "none";
      message: { text: string };
      locations?: Array<{
        physicalLocation: {
          artifactLocation: { uri: string };
          region?: {
            startLine: number;
            endLine?: number;
          };
        };
      }>;
      partialFingerprints?: Record<string, string>;
      fixes?: Array<{
        description: { text: string };
        artifactChanges: Array<{
          artifactLocation: { uri: string };
          replacements: Array<{
            deletedRegion: {
              startLine: number;
              endLine?: number;
            };
            insertedContent?: { text: string };
          }>;
        }>;
      }>;
    }>;
    invocations?: Array<{
      executionSuccessful: boolean;
    }>;
  }>;
}

/**
 * SARIF 2.1.0 subset for Mitii review findings.
 */
export function exportSarif(params: {
  result: ReviewResult;
  toolVersion?: string;
}): SarifReport {
  const findings = params.result.findings;
  const ruleIds = [...new Set(findings.map((f) => f.category))];
  const fingerprintCounts = new Map<string, number>();

  const results = findings.map((finding) => toSarifResult(finding, fingerprintCounts));

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: REVIEW_SARIF_TOOL_NAME,
            informationUri: REVIEW_SARIF_INFORMATION_URI,
            rules: ruleIds.map((id) => ({
              id,
              name: id,
              shortDescription: { text: `Mitii review category: ${id}` },
            })),
          },
        },
        results,
        invocations: [
          {
            executionSuccessful:
              params.result.status === "ok" || params.result.status === "partial",
          },
        ],
      },
    ],
  };
}

function toSarifResult(
  finding: ReviewFinding,
  fingerprintCounts: Map<string, number>,
): SarifReport["runs"][0]["results"][0] {
  let fp = findingFingerprint({
    path: finding.path,
    startLine: finding.startLine,
    content: finding.content,
    existingCode: finding.existingCode,
  });
  const count = (fingerprintCounts.get(fp) ?? 0) + 1;
  fingerprintCounts.set(fp, count);
  if (count > 1) {
    fp = `${fp}#${count}`;
  }

  const result: SarifReport["runs"][0]["results"][0] = {
    ruleId: finding.category,
    level: severityToLevel(finding.severity),
    message: { text: finding.content },
    partialFingerprints: {
      [REVIEW_SARIF_FINGERPRINT_KEY]: fp,
    },
  };

  if (finding.startLine) {
    result.locations = [
      {
        physicalLocation: {
          artifactLocation: { uri: finding.path },
          region: {
            startLine: finding.startLine,
            ...(finding.endLine ? { endLine: finding.endLine } : {}),
          },
        },
      },
    ];
  } else {
    result.locations = [
      {
        physicalLocation: {
          artifactLocation: { uri: finding.path },
        },
      },
    ];
  }

  if (finding.suggestionCode && finding.startLine) {
    result.fixes = [
      {
        description: { text: "Suggested fix" },
        artifactChanges: [
          {
            artifactLocation: { uri: finding.path },
            replacements: [
              {
                deletedRegion: {
                  startLine: finding.startLine,
                  endLine: finding.endLine ?? finding.startLine,
                },
                insertedContent: { text: finding.suggestionCode },
              },
            ],
          },
        ],
      },
    ];
  }

  return result;
}

function severityToLevel(
  severity: ReviewFinding["severity"],
): "error" | "warning" | "note" | "none" {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
      return "note";
    default:
      return "none";
  }
}
