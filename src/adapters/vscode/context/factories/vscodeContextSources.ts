import type { ContextSourceContribution } from '../../../../interfaces/context';
import { CurrentEditorContextSource, OpenFilesContextSource } from '../editorSources';
import { MentionedFileContextSource } from '../mentionedFileSource';
import { GitDiffContextSource, DiagnosticsContextSource } from '../DiagnosticsService';
import type { CeSessionServices } from '../../../../features/ce/tools/sessionServices';

const OWNER = 'ce.context.indexing';

function source(
  id: string,
  phase: ContextSourceContribution['phase'],
  priority: number,
  create: (services: CeSessionServices) => ReturnType<ContextSourceContribution<CeSessionServices>['create']>
): ContextSourceContribution<CeSessionServices> {
  return { id, owner: OWNER, phase, priority, create };
}

/**
 * Real `ContextSourceContribution`s for the four context sources that genuinely need the `vscode`
 * API (editor/tab state, VS Code diagnostics) — wraps the existing classes, doesn't reimplement
 * them. Lives in `adapters/vscode` (not `features/ce`) for the same reason
 * `DiagnosticsService`/`editorSources`/`mentionedFileSource` themselves do.
 */
export const vscodeContextSourceFactories: readonly ContextSourceContribution<CeSessionServices>[] = [
  source('current-editor', 'workspace', 45, (s) => new CurrentEditorContextSource(s.workspace, s.db)),
  source('open-files', 'workspace', 46, (s) => new OpenFilesContextSource(s.workspace, s.db)),
  source('mentioned-files', 'explicit', 5, (s) => new MentionedFileContextSource(s.workspace)),
  source('git-diff', 'diagnostics', 47, (s) => {
    if (!s.gitService) throw new Error('git-diff context source requires GitService');
    return new GitDiffContextSource(s.gitService);
  }),
  source('diagnostics', 'diagnostics', 48, (s) => {
    if (!s.diagnostics) throw new Error('diagnostics context source requires a diagnostics summary');
    // `DiagnosticsContextSource` only ever calls `.formatCompact()`, which the structural
    // `DiagnosticsSummary` type already guarantees — same precedented cast as `createDiagnosticsTool`.
    return new DiagnosticsContextSource(s.diagnostics as never);
  }),
];
