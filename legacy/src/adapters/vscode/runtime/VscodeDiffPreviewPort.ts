import type { DiffPreviewPort } from '../../../interfaces/runtime';
import { showWriteDiffPreview, showPatchDiffPreview } from '../../../vscode/diffPreview';

export class VscodeDiffPreviewPort implements DiffPreviewPort {
  constructor(private readonly workspace: string) {}

  async previewWrite(relPath: string, newContent: string): Promise<void> {
    await showWriteDiffPreview(this.workspace, relPath, newContent);
  }

  async previewPatch(relPath: string, oldText: string, newText: string): Promise<void> {
    await showPatchDiffPreview(this.workspace, relPath, oldText, newText);
  }
}
