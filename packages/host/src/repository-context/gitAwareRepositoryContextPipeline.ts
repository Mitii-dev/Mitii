import {
  RepositoryContextPipeline,
  type GitPort,
  type RepositoryContextPipelineDependencies,
  type RepositoryContextPipelineInput,
  type RepositoryContextPipelineResult,
  type RepositoryStatePipeline,
} from '@mitii/v8';
import {
  DEFAULT_CONTEXT_ROOT_ID,
  mergeContextReferences,
  normalizeContextFileReference,
  resolveDefaultContextRootId,
  toContextFileReferences,
  type HostContextFileReference,
  type HostEditorContextReferences,
} from './hostContextReferences.js';

export class GitAwareRepositoryContextPipeline extends RepositoryContextPipeline {
  public constructor(
    dependencies: RepositoryContextPipelineDependencies,
    private readonly options: {
      git?: GitPort;
      repositoryState: RepositoryStatePipeline;
      workspaceRoot: string;
      includeUntrackedGitFiles: boolean;
      maximumGitDiffFiles: number;
      resolveEditorReferences?: () =>
        | HostEditorContextReferences
        | Promise<HostEditorContextReferences>;
    },
  ) {
    super(dependencies);
  }

  public override async execute(
    input: RepositoryContextPipelineInput,
  ): Promise<RepositoryContextPipelineResult> {
    const { input: enriched, warnings } = await this.enrichInput(input);
    const result = await super.execute(enriched);
    if (warnings.length === 0) {
      return result;
    }
    return {
      ...result,
      warnings: [...result.warnings, ...warnings],
    };
  }

  private async enrichInput(
    input: RepositoryContextPipelineInput,
  ): Promise<{
    input: RepositoryContextPipelineInput;
    warnings: RepositoryContextPipelineResult['warnings'];
  }> {
    const warnings: RepositoryContextPipelineResult['warnings'] = [];
    let next = input;
    const descriptorRead = await this.options.repositoryState.read(input.state);
    const rootId =
      descriptorRead.status === 'found'
        ? resolveDefaultContextRootId(descriptorRead.descriptor)
        : DEFAULT_CONTEXT_ROOT_ID;

    if (this.options.resolveEditorReferences) {
      try {
        const editor = await this.options.resolveEditorReferences();
        const currentFile = editor.currentFile
          ? normalizeContextFileReference(editor.currentFile, rootId)
          : undefined;
        const openFiles = (editor.openFiles ?? [])
          .map((file) => normalizeContextFileReference(file, rootId))
          .filter((file): file is HostContextFileReference => Boolean(file));
        const recentEditFiles = (editor.recentEditFiles ?? [])
          .map((file) => normalizeContextFileReference(file, rootId))
          .filter((file): file is HostContextFileReference => Boolean(file));
        const staleFiles = (editor.staleFiles ?? [])
          .map((file) => normalizeContextFileReference(file, rootId))
          .filter((file): file is HostContextFileReference => Boolean(file));
        next = {
          ...next,
          references: mergeContextReferences(next.references, {
            ...(currentFile ? { currentFile } : {}),
            ...(openFiles.length ? { openFiles } : {}),
            ...(recentEditFiles.length ? { recentEditFiles } : {}),
            ...(staleFiles.length ? { staleFiles } : {}),
          }),
        };
      } catch {
        warnings.push({
          stage: 'selection',
          code: 'editor_references_unavailable',
          message: 'Editor tab references were unavailable for context selection.',
        });
      }
    }

    if (!this.options.git || this.options.maximumGitDiffFiles <= 0) {
      return { input: next, warnings };
    }

    if (descriptorRead.status !== 'found') {
      return { input: next, warnings };
    }

    let status;
    try {
      status = await this.options.git.status({
        workspaceRoot: this.options.workspaceRoot,
        signal: input.abortSignal,
      });
    } catch {
      warnings.push({
        stage: 'selection',
        code: 'git_status_unavailable',
        message: 'Git status was unavailable; dirty-file context priors were skipped.',
      });
      return { input: next, warnings };
    }

    const gitDiffFiles = toContextFileReferences(
      [
        ...status.staged,
        ...status.unstaged,
        ...(this.options.includeUntrackedGitFiles ? status.untracked : []),
      ],
      rootId,
      this.options.maximumGitDiffFiles,
    );

    if (gitDiffFiles.length === 0) {
      return { input: next, warnings };
    }

    return {
      input: {
        ...next,
        references: mergeContextReferences(next.references, {
          gitDiffFiles,
        }),
      },
      warnings,
    };
  }
}
