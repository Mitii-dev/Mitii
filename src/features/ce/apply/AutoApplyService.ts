import type { ToolExecutor } from '../safety/ToolExecutor';
import { parseCodeEdits, type ParsedCodeEdit } from './codeEditParser';
import { createLogger } from '../../../kernel/telemetry/Logger';

const log = createLogger('AutoApplyService');

export interface ApplyEditResult {
  path: string;
  success: boolean;
  pendingApproval?: boolean;
  message: string;
}

export class AutoApplyService {
  constructor(private readonly toolExecutor?: ToolExecutor) {}

  async applyFromResponse(response: string, userMessage: string): Promise<ApplyEditResult[]> {
    if (!this.toolExecutor) {
      return [{ path: '', success: false, message: 'Tool executor not initialized' }];
    }

    const edits = parseCodeEdits(response, userMessage);
    if (edits.length === 0) {
      return [];
    }

    const results: ApplyEditResult[] = [];
    for (const edit of edits) {
      results.push(await this.applyEdit(edit));
    }

    log.info('Auto-apply finished', { edits: edits.length, results: results.length });
    return results;
  }

  private async applyEdit(edit: ParsedCodeEdit): Promise<ApplyEditResult> {
    const result = await this.toolExecutor!.execute('write_file', {
      path: edit.path,
      content: edit.content,
    });

    if (result.pendingApproval) {
      return {
        path: edit.path,
        success: false,
        pendingApproval: true,
        message: `Awaiting approval to write ${edit.path} (${edit.content.length} chars)`,
      };
    }

    if (result.success) {
      return {
        path: edit.path,
        success: true,
        message: `Wrote ${edit.path} (${edit.content.length} chars)`,
      };
    }

    return {
      path: edit.path,
      success: false,
      message: result.error ?? `Failed to write ${edit.path}`,
    };
  }
}
