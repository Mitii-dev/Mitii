export interface ContextItem {
  id: string;
  source: string;
  relPath?: string;
  startLine?: number;
  endLine?: number;
  content: string;
  score: number;
  reason: string;
  tokenEstimate: number;
}

export interface ContextQuery {
  text: string;
  currentFile?: string;
  openFiles?: readonly string[];
  gitDiffFiles?: readonly string[];
  diagnosticFiles?: readonly string[];
  maxItems?: number;
  skipSources?: readonly string[];
}

export interface ContextSource {
  id: string;
  retrieve(query: ContextQuery): Promise<ContextItem[]>;
}

/**
 * `TServices` mirrors `ToolFactoryContribution`'s design: most context sources need workspace-
 * scoped services (a database handle, a retriever, editor state) that only exist once a session
 * is open, not at feature-registration time. Left generic so `interfaces/` never has to import an
 * edition's concrete session-services shape.
 */
export interface ContextSourceContribution<TServices = unknown> {
  id: string;
  owner: string;
  phase: 'explicit' | 'workspace' | 'semantic' | 'diagnostics' | 'memory' | 'external';
  priority: number;
  create(services: TServices): ContextSource;
}
