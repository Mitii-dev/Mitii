import { describe, expect, it } from 'vitest';

import {
  diffAgainstBaseline,
  isTestFile,
  listCrossUnitImports,
  readBaseline,
  WRITE_BASELINES,
  writeBaseline,
} from './support/v8Sources';

const CYCLE_BASELINE = 'module-cycle-baseline.json';

/** Production-only unit graph: unit -> units it imports (relative imports). */
function buildUnitGraph(): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const ref of listCrossUnitImports()) {
    if (isTestFile(ref.file)) continue;
    if (!graph.has(ref.fromUnit)) graph.set(ref.fromUnit, new Set());
    graph.get(ref.fromUnit)!.add(ref.toUnit);
  }
  return graph;
}

/** Tarjan strongly connected components; returns components with >1 unit. */
function findUnitCycles(graph: Map<string, Set<string>>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        onStack.delete(member!);
        component.push(member!);
      } while (member !== node);
      if (component.length > 1) cycles.push(component.sort());
    }
  };

  for (const node of [...graph.keys()].sort()) {
    if (!index.has(node)) visit(node);
  }
  return cycles.sort((a, b) => a.join().localeCompare(b.join()));
}

describe('v8 module dependency cycles', () => {
  it('detects cycles in a synthetic graph (detector self-test)', () => {
    const graph = new Map<string, Set<string>>([
      ['a', new Set(['b'])],
      ['b', new Set(['c'])],
      ['c', new Set(['a'])],
      ['d', new Set(['a'])],
    ]);
    expect(findUnitCycles(graph)).toEqual([['a', 'b', 'c']]);
    expect(findUnitCycles(new Map([['a', new Set(['b'])]]))).toEqual([]);
  });

  it('has no module/engine-component cycles beyond the shrinking baseline', () => {
    const current = findUnitCycles(buildUnitGraph()).map((cycle) =>
      cycle.join(' <-> '),
    );
    if (WRITE_BASELINES) writeBaseline(CYCLE_BASELINE, current);
    const { added, stale } = diffAgainstBaseline(
      current,
      readBaseline<string[]>(CYCLE_BASELINE, []),
    );
    expect(added, 'new module dependency cycle').toEqual([]);
    expect(
      stale,
      `cycle resolved; rerun with MITII_ARCH_WRITE_BASELINES=1 to shrink ${CYCLE_BASELINE}`,
    ).toEqual([]);
  });

  it('keeps decision-policy and tool-runtime acyclic (single ToolGrant owner)', () => {
    const graph = buildUnitGraph();
    expect(graph.get('decision-policy')?.has('tool-runtime') ?? false).toBe(
      false,
    );
    expect(graph.get('tool-runtime')?.has('decision-policy')).toBe(true);
  });

  it('keeps planning independent of tool-runtime', () => {
    expect(buildUnitGraph().get('planning')?.has('tool-runtime') ?? false).toBe(
      false,
    );
  });

  it('keeps leaf modules from importing the engine orchestration', () => {
    const graph = buildUnitGraph();
    for (const [unit, deps] of graph) {
      if (unit === 'v8-engine') continue;
      expect(deps.has('v8-engine'), `${unit} must not import v8-engine`).toBe(
        false,
      );
    }
  });
});
