import { CodeNavigationPipeline } from "../../../modules/code-navigation";
import type { CodeNavigationPort } from "../../../modules/code-navigation";
import type { ToolGrant } from "../../../modules/decision-policy";
import { ToolRuntimeError } from "../contracts";
import {
  findReferencesInputSchema,
  findReferencesOutputSchema,
  gotoDefinitionInputSchema,
  gotoDefinitionOutputSchema,
} from "../internal/ToolCatalog";

export async function executeGotoDefinition(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  codeNavigation?: CodeNavigationPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  return executeCodeNavigationTool({
    ...params,
    operation: "definition",
    inputSchema: gotoDefinitionInputSchema,
    outputSchema: gotoDefinitionOutputSchema,
  });
}

export async function executeFindReferences(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  codeNavigation?: CodeNavigationPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  return executeCodeNavigationTool({
    ...params,
    operation: "references",
    inputSchema: findReferencesInputSchema,
    outputSchema: findReferencesOutputSchema,
  });
}

async function executeCodeNavigationTool(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  codeNavigation?: CodeNavigationPort;
  operation: "definition" | "references";
  inputSchema:
    | typeof gotoDefinitionInputSchema
    | typeof findReferencesInputSchema;
  outputSchema: typeof gotoDefinitionOutputSchema;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  if (!params.codeNavigation) {
    throw new ToolRuntimeError(
      "misconfigured_ports",
      "CodeNavigationPort is required for goto_definition and find_references.",
    );
  }

  const input = params.inputSchema.parse(params.arguments);
  const pipeline = new CodeNavigationPipeline({
    navigation: params.codeNavigation,
  });
  const result = await pipeline.navigate({
    schemaVersion: 1,
    operation: params.operation,
    query: {
      relativePath: input.path,
      line: input.line,
      column: input.column ?? 1,
      ...(input.symbolName ? { symbolName: input.symbolName } : {}),
      ...("includeDeclaration" in input &&
      typeof input.includeDeclaration === "boolean"
        ? { includeDeclaration: input.includeDeclaration }
        : {}),
    },
  });

  const output = params.outputSchema.parse({
    path: input.path,
    provider: result.provider,
    locations: result.locations.map((location) => ({
      path: location.relativePath,
      line: location.startLine,
      ...(location.startColumn ? { column: location.startColumn } : {}),
      ...(location.symbolName ? { symbolName: location.symbolName } : {}),
      ...(location.symbolKind ? { symbolKind: location.symbolKind } : {}),
      ...(location.preview ? { preview: location.preview } : {}),
    })),
    truncated: false,
  });

  return {
    output,
    truncated: false,
    redacted: false,
  };
}
