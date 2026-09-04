import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  findMitiiMonorepoRoot,
  renderLoopPolicyBandsSource,
  renderWindowBudgetBandsSource,
  writeShipBandSources,
} from '../src/writeShipBandSources.js';

describe('writeShipBandSources', () => {
  it('renders compact loop overrides and empty standard', () => {
    const source = renderLoopPolicyBandsSource({
      loop: {
        compact: { explorationRereadMinCalls: 12 },
        standard: {},
        wide: { maxRecoveredAnalysisChars: 640 },
      },
      window: { compact: {}, standard: {}, wide: {} },
    });
    expect(source).toContain('explorationRereadMinCalls: 12');
    expect(source).toContain('maxRecoveredAnalysisChars: 640');
    expect(source).toMatch(/standard: \{[\s\S]*overrides: \{\},/);
  });

  it('writes both band files under a fake monorepo', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-ship-bands-'));
    const loopDir = join(
      root,
      'packages/v8/src/engine/agent-engine/policy',
    );
    const windowDir = join(
      root,
      'packages/v8/src/modules/window-budget',
    );
    mkdirSync(loopDir, { recursive: true });
    mkdirSync(windowDir, { recursive: true });
    writeFileSync(join(loopDir, 'loopPolicyBands.ts'), '// old\n', 'utf8');
    writeFileSync(join(windowDir, 'windowBudgetBands.ts'), '// old\n', 'utf8');

    expect(findMitiiMonorepoRoot([root])).toBe(root);

    const result = writeShipBandSources({
      monorepoRoot: root,
      tables: {
        loop: {
          compact: { maxTruncationRecoveries: 4 },
          standard: {},
          wide: {},
        },
        window: {
          compact: { maxUniqueFilesPerCallCap: 6 },
          standard: {},
          wide: { maxSkillsCap: 6 },
        },
      },
    });

    const loop = readFileSync(result.loopPath, 'utf8');
    const window = readFileSync(result.windowPath, 'utf8');
    expect(loop).toContain('maxTruncationRecoveries: 4');
    expect(window).toContain('maxUniqueFilesPerCallCap: 6');
    expect(window).toContain('maxSkillsCap: 6');
  });
});
