import {
  modelEventSchema,
  modelRequestSchema,
} from "../../../../model-gateway";

import type {
  LlmPort,
  ModelRequest,
} from "../../../../model-gateway";

import { IntentClassification, intentClassificationSchema } from "../../schema";
import { IntentClassificationInput, ReferencedArtifact } from "../../types";
import type { DiagnosticSummary } from "../../../contracts";
import { LLM_INTENT_CLASSIFICATION_SYSTEM_PROMPT } from "./prompts";


export class LlmIntentClassifier {
  constructor(private readonly provider: LlmPort) {}

  async classify(
    input: IntentClassificationInput,
  ): Promise<IntentClassification> {
    const message = input.userMessage.trim();

    const referencedArtifacts = this.normalizeReferencedArtifacts(
      input.referencedArtifacts,
    );

    if (!message && referencedArtifacts.length === 0) {
      throw new Error(
        "LLM intent classifier requires a user message or referenced artifact.",
      );
    }

    const request =
      modelRequestSchema.parse({
      messages: [
        {
          role: "system",
          content: LLM_INTENT_CLASSIFICATION_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: this.buildUserPrompt(
            message,
            referencedArtifacts,
            input.diagnosticSummary,
          ),
        },
      ],
      temperature: 0,
      maximumOutputTokens: 1000,
      stream: false,
      toolChoice: "none",
      reasoning: {
        enabled: false,
        effort: "low",
        includeInResponse: false,
      },
    }) as ModelRequest;

    const response = await this.collectProviderText(request);

    return this.parseClassification(response);
  }

  private buildUserPrompt(
    message: string,
    referencedArtifacts: readonly ReferencedArtifact[],
    diagnosticSummary?: DiagnosticSummary,
  ): string {
    const sections: string[] = [
      '<message_to_classify trust="untrusted-data">',
      message,
      "</message_to_classify>",
    ];

    if (referencedArtifacts.length > 0) {
      sections.push(
        "",
        '<referenced_artifacts trust="untrusted-data">',
        JSON.stringify(referencedArtifacts, null, 2),
        "</referenced_artifacts>",
      );
    }

    if (diagnosticSummary && diagnosticSummary.errorCount > 0) {
      sections.push(
        "",
        '<preflight_diagnostics trust="untrusted-data">',
        "Evidence only — do not choose a route or grant from this, only whether the ask reads as a repair.",
        JSON.stringify(
          {
            errorCount: diagnosticSummary.errorCount,
            inScopeErrorCount: diagnosticSummary.inScopeErrorCount,
            diagnostics: diagnosticSummary.diagnostics,
          },
          null,
          2,
        ),
        "</preflight_diagnostics>",
      );
    }

    return sections.join("\n");
  }

  private normalizeReferencedArtifacts(
    artifacts?: readonly ReferencedArtifact[],
  ): ReferencedArtifact[] {
    if (!artifacts?.length) {
      return [];
    }

    return artifacts
      .filter((artifact) => artifact.name.trim())
      .slice(0, 20)
      .map((artifact) => {
        const name = this.truncate(artifact.name.trim(), 300);

        const path = artifact.path?.trim()
          ? this.truncate(artifact.path.trim(), 500)
          : undefined;

        const extension = artifact.extension?.trim()
          ? this.normalizeExtension(artifact.extension)
          : this.extractExtension(path ?? name);

        const language = artifact.language?.trim()
          ? this.truncate(artifact.language.trim().toLowerCase(), 100)
          : undefined;

        return {
          name,
          kind: artifact.kind,
          ...(path ? { path } : {}),
          ...(extension ? { extension } : {}),
          ...(language ? { language } : {}),
        };
      });
  }

  private normalizeExtension(extension: string): string {
    const normalized = extension.trim().toLowerCase();

    const withPeriod = normalized.startsWith(".")
      ? normalized
      : `.${normalized}`;

    return this.truncate(withPeriod, 30);
  }

  private extractExtension(value: string): string | undefined {
    const normalized = value.trim().replace(/\\/g, "/");

    const finalSegment = normalized.split("/").pop() ?? "";

    const finalPeriod = finalSegment.lastIndexOf(".");

    if (finalPeriod <= 0 || finalPeriod === finalSegment.length - 1) {
      return undefined;
    }

    return this.normalizeExtension(finalSegment.slice(finalPeriod));
  }

  private truncate(value: string, maximumLength: number): string {
    if (value.length <= maximumLength) {
      return value;
    }

    return `${value.slice(0, maximumLength - 1)}…`;
  }

  /**
   * Collects text from the provider's AsyncIterable response.
   */
  private async collectProviderText(request: ModelRequest): Promise<string> {
    let response = "";
    let reasoning = "";

    for await (const rawEvent of this.provider.complete(request)) {
      const event = modelEventSchema.parse(rawEvent);

      if (event.type === "failed" || event.type === "cancelled") {
        throw new Error(
          `Intent classifier provider error ` +
            `(${event.error.code}): ` +
            event.error.message,
        );
      }

      if (event.type === "content_delta") {
        response += event.content;
      }

      // Some providers put the JSON payload in reasoning when content is empty.
      if (event.type === "reasoning_delta") {
        reasoning += event.reasoning;
      }
    }

    const text = response.trim() || reasoning.trim();
    if (!text) {
      throw new Error("Intent classifier returned an empty response.");
    }

    return text;
  }

  /**
   * Extracts and validates the classification returned by the LLM.
   *
   * Objects are evaluated from last to first because some providers may
   * accidentally include an example object before their final response.
   */
  private parseClassification(response: string): IntentClassification {
    const objects = this.extractJsonObjects(response);

    let lastError: unknown;

    for (let index = objects.length - 1; index >= 0; index -= 1) {
      try {
        const candidate =
          objects[index];

        if (!candidate) {
          continue;
        }

        const parsed: unknown =
          JSON.parse(
            candidate,
          );

        return intentClassificationSchema.parse(parsed);
      } catch (error) {
        lastError = error;
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : String(lastError);

    throw new Error(
      `Intent classifier returned no valid classification: ${message}`,
    );
  }

  /**
   * Extracts balanced JSON objects from a provider response while
   * respecting quoted strings and escaped characters.
   */
  private extractJsonObjects(response: string): string[] {
    const text = response.trim();
    const objects: string[] = [];

    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\" && inString) {
        escaped = true;
        continue;
      }

      if (character === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (character === "{") {
        if (depth === 0) {
          start = index;
        }

        depth += 1;
        continue;
      }

      if (character !== "}") {
        continue;
      }

      depth -= 1;

      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1));

        start = -1;
      }

      if (depth < 0) {
        break;
      }
    }

    if (objects.length === 0) {
      throw new Error(
        "Intent classifier did not return a complete JSON object.",
      );
    }

    return objects;
  }
}
