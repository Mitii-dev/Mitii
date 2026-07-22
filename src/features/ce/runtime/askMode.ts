import type { ToolDefinition } from '../../../kernel/llm/toolTypes';
import { routeAskIntent } from '../modes/ask/AskIntentRouter';
import { ASK_ALLOWED_TOOL_IDS, ASK_GROUNDING_TOOL_IDS } from '../tools/toolMetadata';

/** @deprecated Use ASK_ALLOWED_TOOL_IDS from toolMetadata. */
export const ASK_ALLOWED_TOOLS = ASK_ALLOWED_TOOL_IDS;

const GROUNDING_TOOLS = ASK_GROUNDING_TOOL_IDS;

export function filterAskModeTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.filter((tool) => isAskAllowedTool(tool.function.name));
}

export function isAskAllowedTool(toolName: string): boolean {
  if (ASK_ALLOWED_TOOL_IDS.has(toolName)) return true;
  if (!toolName.startsWith('mcp__')) return false;
  return !/(?:write|create|delete|remove|move|rename|update|patch|commit|push|merge|dispatch|publish)/i.test(toolName);
}

/** Whether the answer should be grounded in codebase reads/searches before finishing. */
export function needsAskGrounding(userMessage: string): boolean {
  const text = userMessage.trim();
  if (!text) return false;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay)\b/i.test(text) && text.length < 48) return false;
  if (routeAskIntent(text).intent === 'general_knowledge') return false;
  return true;
}

export function isGeneralKnowledgeQuestion(text: string): boolean {
  const hasCodebaseRef =
    /\b(codebase|project|repo|repository|this file|our app|our code|workspace)\b/i.test(text) ||
    /\b(src\/|\.tsx?|\.jsx?|\.py|\.go|\.rs|\.mdx?)\b/i.test(text) ||
    /@[\w./-]+/.test(text);

  if (hasCodebaseRef) return false;

  return /^(what is|what are|explain the concept|define|difference between)\b/i.test(text);
}

/** Enable read-only research subagents for broad Ask-mode exploration. */
export function shouldEnableAskSubagents(userMessage: string): boolean {
  if (!needsAskGrounding(userMessage)) return false;
  const text = userMessage.trim();
  const route = routeAskIntent(text);
  if (route.shouldUseSubagents) return true;
  return (
    text.length > 120 ||
    /\b(how does|how do|architecture|across|entire|whole codebase|all files|map out|overview|trace|flow)\b/i.test(text)
  );
}

export function isGroundingToolCall(toolName: string): boolean {
  return GROUNDING_TOOLS.has(toolName) || (toolName.startsWith('mcp__') && isAskAllowedTool(toolName));
}

export const ASK_SYNTHESIS_NUDGE = `You have finished read-only exploration for this Ask-mode turn.

Provide your complete final answer NOW in plain text:
- Answer the user's question directly with citations (\`path:line\`) from files you read or tools you ran.
- Do NOT call any more tools in this turn.
- If something could not be verified, say so explicitly.`;

export const NO_TOOLS_ASK_NUDGE = `You are in Ask mode and have not read or searched the codebase yet. Ask mode answers MUST be grounded in repository evidence when the question is about this project.

In this turn, call at least one read-only tool:
- read_file / read_files — inspect specific files
- search / search_batch — find symbols, routes, or patterns
- retrieve_context / repo_map / project_catalog — widen project context
- diagnostics / git_diff — inspect current problems or changes when relevant
- use_skill — load a deferred skill when playbooks are not pre-loaded

Then answer the user's question with citations. Do NOT write files in Ask mode.`;
