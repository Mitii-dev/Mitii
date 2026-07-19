import { existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { Project, Node, ts, type Identifier, type Symbol as MorphSymbol } from 'ts-morph';
import type { IgnoreService } from './IgnoreService';
import type { IndexingConfig } from '../../../kernel/config/schema';
import { FileDiscoveryService } from './FileDiscoveryService';
import { UNKNOWN_HEALTH, summarizeHealthDetail, type ComponentHealth } from './ComponentHealth';
import { createLogger } from '../../../kernel/telemetry/Logger';

const log = createLogger('WorkspaceLanguageService');

const TS_LIKE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);

export interface DefinitionResult {
  relPath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  kind: string;
  name: string;
  preview: string;
}

export interface CallerResult {
  relPath: string;
  line: number;
  column: number;
  preview: string;
  enclosingSymbol?: string;
}

export function isTsLikeFile(pathOrName: string): boolean {
  const dot = pathOrName.lastIndexOf('.');
  if (dot === -1) return false;
  return TS_LIKE_EXTENSIONS.has(pathOrName.slice(dot).toLowerCase());
}

/** Persistent, per-workspace ts-morph Project backing precise cross-file symbol resolution.
 * Lazily initialized on first use — constructing a full Program eagerly for every workspace
 * would tax startup latency for workspaces that never need it. */
export class WorkspaceLanguageService {
  private project: Project | undefined;
  private health: ComponentHealth = UNKNOWN_HEALTH;

  constructor(
    private readonly workspaceRoot: string,
    private readonly ignoreService: IgnoreService,
    private readonly config: IndexingConfig
  ) {}

  getHealth(): ComponentHealth {
    return this.health;
  }

  dispose(): void {
    this.project = undefined;
  }

  private ensureProject(): Project | undefined {
    if (this.project) return this.project;

    try {
      const tsConfigFilePath = join(this.workspaceRoot, 'tsconfig.json');
      if (existsSync(tsConfigFilePath)) {
        this.project = new Project({
          tsConfigFilePath,
          skipFileDependencyResolution: false,
          skipAddingFilesFromTsConfig: false,
        });
      } else {
        this.project = new Project({
          compilerOptions: {
            allowJs: true,
            jsx: ts.JsxEmit.ReactJSX,
            target: ts.ScriptTarget.ES2020,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            module: ts.ModuleKind.ESNext,
          },
        });
        this.addWorkspaceFilesManually(this.project);
      }
      this.health = { status: 'ready' };
    } catch (error) {
      this.health = { status: 'degraded', detail: summarizeHealthDetail(error) };
      log.warn('Failed to initialize language service project', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.project = undefined;
    }

    return this.project;
  }

  private addWorkspaceFilesManually(project: Project): void {
    const discovery = new FileDiscoveryService(this.workspaceRoot, this.ignoreService, this.config);
    for (const file of discovery.discover()) {
      if (!isTsLikeFile(file.relPath)) continue;
      try {
        project.addSourceFileAtPath(file.absPath);
      } catch {
        // Unreadable/unparsable file — skip rather than fail the whole project.
      }
    }
  }

  private absPath(relPath: string): string {
    return join(this.workspaceRoot, relPath);
  }

  /** Sync unsaved editor content into the in-memory AST. Must never throw — a bad keystroke-in-flight
   * parse should degrade gracefully rather than break the caller (VS Code text-change events). */
  updateFile(relPath: string, content: string): void {
    const project = this.ensureProject();
    if (!project) return;

    try {
      const absPath = this.absPath(relPath);
      const existing = project.getSourceFile(absPath);
      if (existing) {
        existing.replaceWithText(content);
      } else {
        project.createSourceFile(absPath, content, { overwrite: true });
      }
    } catch (error) {
      log.debug('updateFile failed', { relPath, error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Re-reads a file from disk — used for external changes (file watcher: create/change/delete). */
  syncFileFromDisk(relPath: string): void {
    const project = this.ensureProject();
    if (!project) return;

    const absPath = this.absPath(relPath);
    if (!existsSync(absPath)) {
      const existing = project.getSourceFile(absPath);
      if (existing) project.removeSourceFile(existing);
      return;
    }

    try {
      const content = readFileSync(absPath, 'utf-8');
      this.updateFile(relPath, content);
    } catch (error) {
      log.debug('syncFileFromDisk failed', { relPath, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private getIdentifierAt(relPath: string, line: number, column: number): Identifier | undefined {
    const project = this.ensureProject();
    if (!project) return undefined;

    const sourceFile = project.getSourceFile(this.absPath(relPath));
    if (!sourceFile) return undefined;

    const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(Math.max(0, line - 1), Math.max(0, column - 1));
    const descendant = sourceFile.getDescendantAtPos(pos);
    if (!descendant) return undefined;
    if (Node.isIdentifier(descendant)) return descendant;

    // Position may have landed just before/inside the identifier's parent — check immediate children.
    const child = descendant.getChildren().find((c) => Node.isIdentifier(c) && c.getStart() <= pos && pos <= c.getEnd());
    return child && Node.isIdentifier(child) ? child : undefined;
  }

  /** Finds an identifier's column on a given line by exact word match — used when only a name and
   * line are known (e.g. from the DB's `symbols` table, which has no column). */
  findColumnForName(relPath: string, line: number, name: string): number | undefined {
    const project = this.ensureProject();
    if (!project) return undefined;
    const sourceFile = project.getSourceFile(this.absPath(relPath));
    if (!sourceFile) return undefined;

    const lineText = sourceFile.getFullText().split('\n')[line - 1];
    if (lineText === undefined) return undefined;

    const wordRegex = new RegExp(`\\b${escapeRegex(name)}\\b`);
    const match = wordRegex.exec(lineText);
    return match ? match.index + 1 : undefined;
  }

  /** Cross-file go-to-definition, resolved through re-export/alias chains so a name-only lookup
   * lands on the true declaration rather than a re-export specifier. */
  getDefinition(relPath: string, line: number, column: number): DefinitionResult[] {
    try {
      const identifier = this.getIdentifierAt(relPath, line, column);
      if (!identifier) return [];

      const results: DefinitionResult[] = [];
      const seen = new Set<string>();

      for (const def of identifier.getDefinitions()) {
        const declNode = resolveThroughAliases(identifier, def.getDeclarationNode());
        const sourceFile = declNode?.getSourceFile() ?? def.getSourceFile();
        if (!sourceFile) continue;

        const span = declNode ? declNode.getStart() : def.getTextSpan().getStart();
        const endPos = declNode ? declNode.getEnd() : span + def.getTextSpan().getLength();
        const start = sourceFile.compilerNode.getLineAndCharacterOfPosition(span);
        const end = sourceFile.compilerNode.getLineAndCharacterOfPosition(endPos);
        const relDefPath = relative(this.workspaceRoot, sourceFile.getFilePath()).replace(/\\/g, '/');

        const key = `${relDefPath}:${start.line}:${start.character}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          relPath: relDefPath,
          startLine: start.line + 1,
          startColumn: start.character + 1,
          endLine: end.line + 1,
          endColumn: end.character + 1,
          kind: def.getKind(),
          name: def.getName(),
          preview: sourceFile.getFullText().split('\n').slice(start.line, start.line + 3).join('\n').slice(0, 300),
        });
      }

      return results;
    } catch (error) {
      log.debug('getDefinition failed', { relPath, line, column, error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /** Finds actual call sites of the symbol at this position — filters find-references down to
   * references that are the callee of a CallExpression/NewExpression, excluding imports, type
   * annotations, destructuring, and the definition itself. Best-effort: cannot resolve dynamic
   * dispatch (`handlers[key]()`) or interface-mediated polymorphic calls to their concrete impl. */
  getCallers(relPath: string, line: number, column: number): CallerResult[] {
    try {
      const identifier = this.getIdentifierAt(relPath, line, column);
      if (!identifier) return [];

      const callers: CallerResult[] = [];
      for (const referencedSymbol of identifier.findReferences()) {
        for (const entry of referencedSymbol.getReferences()) {
          if (entry.isDefinition()) continue;

          const node = entry.getNode();
          if (!isCallSite(node)) continue;

          const sourceFile = entry.getSourceFile();
          const start = sourceFile.compilerNode.getLineAndCharacterOfPosition(node.getStart());
          const lineText = sourceFile.getFullText().split('\n')[start.line] ?? '';

          callers.push({
            relPath: relative(this.workspaceRoot, sourceFile.getFilePath()).replace(/\\/g, '/'),
            line: start.line + 1,
            column: start.character + 1,
            preview: lineText.trim().slice(0, 200),
            enclosingSymbol: getEnclosingSymbolName(node),
          });
        }
      }

      return callers;
    } catch (error) {
      log.debug('getCallers failed', { relPath, line, column, error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Walks past re-export/alias indirection (e.g. `export { foo } from './impl'`) to the real
 * declaration. `export *` barrels are not expanded here — a documented limitation, not a bug:
 * they don't create a per-name symbol for the checker to follow. */
function resolveThroughAliases(identifier: Identifier, declNode: Node | undefined): Node | undefined {
  let symbol: MorphSymbol | undefined = identifier.getSymbol();
  if (!symbol) return declNode;

  const visited = new Set<MorphSymbol>();
  while (symbol.isAlias() && !visited.has(symbol)) {
    visited.add(symbol);
    const aliased = symbol.getAliasedSymbol();
    if (!aliased) break;
    symbol = aliased;
  }

  const declarations = symbol.getDeclarations();
  return declarations[0] ?? declNode;
}

function isCallSite(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;

  if (Node.isCallExpression(parent) || Node.isNewExpression(parent)) {
    return parent.getExpression() === node;
  }

  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) {
    const grandParent = parent.getParent();
    if (Node.isCallExpression(grandParent) || Node.isNewExpression(grandParent)) {
      return grandParent.getExpression() === parent;
    }
  }

  return false;
}

function getEnclosingSymbolName(node: Node): string | undefined {
  const enclosing = node.getFirstAncestor(
    (n) => Node.isFunctionDeclaration(n) || Node.isMethodDeclaration(n) || Node.isClassDeclaration(n) || Node.isArrowFunction(n) || Node.isFunctionExpression(n)
  );
  if (!enclosing) return undefined;

  if (Node.isFunctionDeclaration(enclosing) || Node.isMethodDeclaration(enclosing) || Node.isClassDeclaration(enclosing)) {
    return enclosing.getName();
  }

  if (Node.isArrowFunction(enclosing) || Node.isFunctionExpression(enclosing)) {
    const varDecl = enclosing.getFirstAncestor((n) => Node.isVariableDeclaration(n));
    return varDecl && Node.isVariableDeclaration(varDecl) ? varDecl.getName() : undefined;
  }

  return undefined;
}
