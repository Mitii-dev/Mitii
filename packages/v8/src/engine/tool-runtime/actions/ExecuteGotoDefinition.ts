import { CodeNavigationPipeline } from "../../../modules/code-navigation";
import type { CodeNavigationPort } from "../../../modules/code-navigation";
import type { ToolGrant } from "../../../modules/decision-policy";
import { ToolRuntimeError } from "../contracts";
import {
  callHierarchyInputSchema,
  documentSymbolInputSchema,
  findImplementationInputSchema,
  findReferencesInputSchema,
  findReferencesOutputSchema,
  gotoDefinitionInputSchema,
  gotoDefinitionOutputSchema,
  hoverSymbolInputSchema,
  hoverSymbolOutputSchema,
  symbolLocationsOutputSchema,
  workspaceSymbolInputSchema,
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

export async function executeHoverSymbol(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  codeNavigation?: CodeNavigationPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  if (!params.codeNavigation) {
    throw new ToolRuntimeError(
      "misconfigured_ports",
      "CodeNavigationPort is required for hover_symbol.",
    );
  }

  const input = hoverSymbolInputSchema.parse(params.arguments);
  const pipeline = new CodeNavigationPipeline({
    navigation: params.codeNavigation,
  });
  const result = await pipeline.navigate({
    schemaVersion: 1,
    operation: "hover",
    query: {
      relativePath: input.path,
      line: input.line,
      column: input.column ?? 1,
      ...(input.symbolName ? { symbolName: input.symbolName } : {}),
    },
  });

  const output = hoverSymbolOutputSchema.parse({
    path: input.path,
    provider: result.provider,
    ...(result.hover ? { hover: result.hover } : {}),
    truncated: false,
  });

  return {
    output,
    truncated: false,
    redacted: false,
  };
}

export async function executeDocumentSymbol(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  codeNavigation?: CodeNavigationPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  return executeSymbolList({
    ...params,
    operation: "document_symbols",
    inputSchema: documentSymbolInputSchema,
    missingMessage: "CodeNavigationPort is required for document_symbol.",
  });
}

export async function executeWorkspaceSymbol(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  codeNavigation?: CodeNavigationPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  return executeSymbolList({
    ...params,
    operation: "workspace_symbols",
    inputSchema: workspaceSymbolInputSchema,
    missingMessage: "CodeNavigationPort is required for workspace_symbol.",
  });
}

export async function executeFindImplementation(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  codeNavigation?: CodeNavigationPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  return executeCodeNavigationTool({
    ...params,
    operation: "implementation",
    inputSchema: findImplementationInputSchema,
    outputSchema: symbolLocationsOutputSchema,
  });
}

export async function executeCallHierarchy(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  codeNavigation?: CodeNavigationPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  return executeCodeNavigationTool({
    ...params,
    operation: "call_hierarchy",
    inputSchema: callHierarchyInputSchema,
    outputSchema: symbolLocationsOutputSchema,
  });
}

async function executeSymbolList(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  codeNavigation?: CodeNavigationPort;
  operation: "document_symbols" | "workspace_symbols";
  inputSchema:
    | typeof documentSymbolInputSchema
    | typeof workspaceSymbolInputSchema;
  missingMessage: string;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  if (!params.codeNavigation) {
    throw new ToolRuntimeError("misconfigured_ports", params.missingMessage);
  }
  const input = params.inputSchema.parse(params.arguments);
  const pipeline = new CodeNavigationPipeline({
    navigation: params.codeNavigation,
  });
  const query =
    "path" in input
      ? { relativePath: input.path }
      : { query: input.query };
  const result = await pipeline.navigate({
    schemaVersion: 1,
    operation: params.operation,
    query,
  });
  const output = symbolLocationsOutputSchema.parse({
    path: "path" in input ? input.path : input.query,
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
  return { output, truncated: false, redacted: false };
}

async function executeCodeNavigationTool(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  codeNavigation?: CodeNavigationPort;
  operation: "definition" | "references" | "implementation" | "call_hierarchy";
  inputSchema:
    | typeof gotoDefinitionInputSchema
    | typeof findReferencesInputSchema
    | typeof findImplementationInputSchema
    | typeof callHierarchyInputSchema;
  outputSchema: typeof gotoDefinitionOutputSchema;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  if (!params.codeNavigation) {
    throw new ToolRuntimeError(
      "misconfigured_ports",
      "CodeNavigationPort is required for goto_definition, find_references, and find_implementation.",
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
      ...("direction" in input &&
      (input.direction === "incoming" || input.direction === "outgoing")
        ? { direction: input.direction }
        : {}),
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
