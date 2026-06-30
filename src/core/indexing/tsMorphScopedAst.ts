import { Project, type SourceFile, type Statement, SyntaxKind } from 'ts-morph';
import type { FormattedSymbol } from '../context/symbolFormat';

const MAX_SYMBOLS = 40;

/** Rich scoped AST outline for TypeScript/JavaScript when tree-sitter/index data is unavailable. */
export function extractTsMorphSymbols(relPath: string, content: string): FormattedSymbol[] {
  try {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        allowJs: true,
        jsx: relPath.endsWith('.tsx') || relPath.endsWith('.jsx') ? 2 : undefined,
      },
    });
    const sourceFile = project.createSourceFile(relPath, content, { overwrite: true });
    return collectTopLevelSymbols(sourceFile).slice(0, MAX_SYMBOLS);
  } catch {
    return [];
  }
}

function isStatementExported(statement: Statement): boolean {
  if ('hasModifier' in statement) {
    const modifiable = statement as Statement & { hasModifier(kind: SyntaxKind): boolean };
    return modifiable.hasModifier(SyntaxKind.ExportKeyword);
  }
  return statement.getText().trimStart().startsWith('export');
}

function collectTopLevelSymbols(sourceFile: SourceFile): FormattedSymbol[] {
  const symbols: FormattedSymbol[] = [];

  for (const statement of sourceFile.getStatements()) {
    const exported = isStatementExported(statement);
    const kind = statement.getKind();

    if (kind === SyntaxKind.FunctionDeclaration) {
      const fn = statement.asKindOrThrow(SyntaxKind.FunctionDeclaration);
      const name = fn.getName();
      if (!name) continue;
      symbols.push({
        name,
        kind: 'function',
        exported,
        signature: fn.getText().split('\n').slice(0, 3).join(' ').slice(0, 120),
      });
      continue;
    }

    if (kind === SyntaxKind.ClassDeclaration) {
      const cls = statement.asKindOrThrow(SyntaxKind.ClassDeclaration);
      const name = cls.getName();
      if (!name) continue;
      symbols.push({
        name,
        kind: 'class',
        exported,
        signature: summarizeClass(cls.getText()),
      });
      continue;
    }

    if (kind === SyntaxKind.InterfaceDeclaration) {
      const iface = statement.asKindOrThrow(SyntaxKind.InterfaceDeclaration);
      symbols.push({
        name: iface.getName(),
        kind: 'interface',
        exported,
        signature: iface.getText().split('\n').slice(0, 2).join(' ').slice(0, 120),
      });
      continue;
    }

    if (kind === SyntaxKind.TypeAliasDeclaration) {
      const alias = statement.asKindOrThrow(SyntaxKind.TypeAliasDeclaration);
      symbols.push({
        name: alias.getName(),
        kind: 'type',
        exported,
        signature: alias.getText().split('\n').slice(0, 2).join(' ').slice(0, 120),
      });
      continue;
    }

    if (kind === SyntaxKind.EnumDeclaration) {
      const en = statement.asKindOrThrow(SyntaxKind.EnumDeclaration);
      symbols.push({
        name: en.getName(),
        kind: 'enum',
        exported,
        signature: en.getText().split('\n').slice(0, 2).join(' ').slice(0, 120),
      });
      continue;
    }

    if (kind === SyntaxKind.VariableStatement) {
      const vars = statement.asKindOrThrow(SyntaxKind.VariableStatement);
      for (const decl of vars.getDeclarations()) {
        const name = decl.getName();
        const init = decl.getInitializer();
        const isFn = init?.getKind() === SyntaxKind.ArrowFunction ||
          init?.getKind() === SyntaxKind.FunctionExpression;
        symbols.push({
          name,
          kind: isFn ? 'function' : 'const',
          exported,
          signature: decl.getText().split('\n').slice(0, 2).join(' ').slice(0, 120),
        });
      }
    }
  }

  return symbols;
}

function summarizeClass(text: string): string {
  const header = text.split('{')[0]?.trim() ?? text;
  return header.slice(0, 120);
}
