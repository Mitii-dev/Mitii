import { describe, expect, it } from 'vitest';

import {
  appendActivitySegment,
  shouldReplaceActivity,
} from '../src/activitySegments';
import type { ActivityEventPayload } from '../src/protocol';

function tool(
  title: string,
  status: string,
  detail?: string,
  id = `evt_${title}_${status}`,
): ActivityEventPayload {
  return {
    id,
    at: Date.now(),
    kind: 'tool',
    title,
    detail,
    status,
  };
}

describe('activitySegments (chat tool visibility)', () => {
  it('only replaces an in-flight running row, not a finished same-named tool', () => {
    expect(
      shouldReplaceActivity(
        { kind: 'tool', title: 'Running apply_patch', status: 'running' },
        { kind: 'tool', title: 'apply_patch', status: 'succeeded' },
      ),
    ).toBe(true);
    expect(
      shouldReplaceActivity(
        { kind: 'tool', title: 'apply_patch', status: 'succeeded' },
        { kind: 'tool', title: 'Running apply_patch', status: 'running' },
      ),
    ).toBe(false);
  });

  it('keeps successive apply_patch calls as separate chat rows (Gemini 01:45)', () => {
    let segments = appendActivitySegment(
      [],
      tool('Running apply_patch', 'running', 'paths=a.ts'),
      400,
      (p) => `${p}_1`,
    );
    segments = appendActivitySegment(
      segments,
      tool('apply_patch', 'succeeded', 'paths=a.ts'),
      400,
      (p) => `${p}_2`,
    );
    segments = appendActivitySegment(
      segments,
      tool('Running apply_patch', 'running', 'paths=b.ts'),
      400,
      (p) => `${p}_3`,
    );
    segments = appendActivitySegment(
      segments,
      tool('apply_patch', 'succeeded', 'paths=b.ts'),
      400,
      (p) => `${p}_4`,
    );
    segments = appendActivitySegment(
      segments,
      tool('Running apply_patch', 'running', 'paths=c.ts'),
      400,
      (p) => `${p}_5`,
    );
    segments = appendActivitySegment(
      segments,
      tool('apply_patch', 'succeeded', 'paths=c.ts'),
      400,
      (p) => `${p}_6`,
    );

    const patches = segments.filter(
      (s) => s.kind === 'activity' && s.event.kind === 'tool',
    );
    expect(patches).toHaveLength(3);
    expect(patches.map((s) => (s.kind === 'activity' ? s.event.detail : ''))).toEqual([
      'paths=a.ts',
      'paths=b.ts',
      'paths=c.ts',
    ]);
    expect(
      patches.every(
        (s) => s.kind === 'activity' && s.event.status === 'succeeded',
      ),
    ).toBe(true);
  });

  it('still merges Running → completed for a single in-flight tool', () => {
    let segments = appendActivitySegment(
      [],
      tool('Running apply_patch', 'running', 'paths=a.ts'),
      400,
      (p) => `${p}_a`,
    );
    segments = appendActivitySegment(
      segments,
      tool('apply_patch', 'succeeded', 'paths=a.ts'),
      400,
      (p) => `${p}_b`,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      kind: 'activity',
      event: { title: 'apply_patch', status: 'succeeded', detail: 'paths=a.ts' },
    });
  });
});
