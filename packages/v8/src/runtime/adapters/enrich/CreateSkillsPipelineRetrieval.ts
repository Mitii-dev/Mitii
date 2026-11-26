/**
 * Skills module → RuntimeSkillsRetrievalPort.
 */

import {
  SKILLS_SCHEMA_VERSION,
  type SkillsPipeline,
} from "../../../modules/skills";
import type { RuntimeSkillsRetrievalPort } from "../../ports/RuntimeEnrichRetrievalPorts";

const EXECUTION_ROUTES = [
  "answer",
  "direct_answer",
  "repository_answer",
  "clarify",
  "diagnose",
  "plan",
  "execute",
] as const;

type ExecutionRoute = (typeof EXECUTION_ROUTES)[number];

function mapExecutionRoute(route?: string): ExecutionRoute {
  if (route === "direct_answer" || route === "repository_answer") {
    return "answer";
  }
  if (route && (EXECUTION_ROUTES as readonly string[]).includes(route)) {
    return route as ExecutionRoute;
  }
  return "execute";
}

export interface CreateSkillsPipelineRetrievalOptions {
  pipeline: SkillsPipeline;
  /** Soft query when skill ids alone are insufficient for match. */
  defaultQuery?: string;
  mode?: "ask" | "plan" | "agent";
}

export function createSkillsPipelineRetrieval(
  options: CreateSkillsPipelineRetrievalOptions,
): RuntimeSkillsRetrievalPort {
  const mode = options.mode ?? "agent";
  const defaultQuery = options.defaultQuery ?? "skill selection";

  return {
    async retrieve(input) {
      const max = input.maxItems ?? 16;
      const route = mapExecutionRoute(input.route);

      const result = await options.pipeline.select({
        schemaVersion: SKILLS_SCHEMA_VERSION,
        query: defaultQuery,
        mode,
        route,
        evidence: {
          primaryIntent: "general",
          paths: [],
        },
        requiredSkillIds: [...input.skillIds],
        maxSkills: max,
      });

      const items = result.instructions
        .slice(0, max)
        .map((block) => block.content);

      return {
        items,
        reasonCodes: [
          "skills_pipeline_retrieved",
          ...result.reasonCodes.map(String),
        ],
      };
    },
  };
}
