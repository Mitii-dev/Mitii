/**
 * Reflective chain-of-thought bookkeeping (servers-main sequentialthinking).
 * Pure domain — no MCP, no chalk. Tool Runtime owns wire + schema.
 */

export interface ThoughtData {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
}

export interface SequentialThinkingResult {
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  branches: string[];
  thoughtHistoryLength: number;
}

export class SequentialThinkingEngine {
  private readonly thoughtHistory: ThoughtData[] = [];
  private readonly branches: Record<string, ThoughtData[]> = {};

  public processThought(input: ThoughtData): SequentialThinkingResult {
    const thought: ThoughtData = { ...input };
    if (thought.thoughtNumber > thought.totalThoughts) {
      thought.totalThoughts = thought.thoughtNumber;
    }

    this.thoughtHistory.push(thought);

    if (thought.branchFromThought && thought.branchId) {
      const list = this.branches[thought.branchId] ?? [];
      list.push(thought);
      this.branches[thought.branchId] = list;
    }

    return {
      thoughtNumber: thought.thoughtNumber,
      totalThoughts: thought.totalThoughts,
      nextThoughtNeeded: thought.nextThoughtNeeded,
      branches: Object.keys(this.branches),
      thoughtHistoryLength: this.thoughtHistory.length,
    };
  }

  public reset(): void {
    this.thoughtHistory.length = 0;
    for (const key of Object.keys(this.branches)) {
      delete this.branches[key];
    }
  }

  public get historyLength(): number {
    return this.thoughtHistory.length;
  }
}

/**
 * Process-local engines keyed by workspace root so multi-turn agent loops
 * keep branch/revision history without a host port.
 */
const enginesByWorkspace = new Map<string, SequentialThinkingEngine>();

export function getSequentialThinkingEngine(
  workspaceRoot: string,
): SequentialThinkingEngine {
  const key = workspaceRoot.length > 0 ? workspaceRoot : "__default__";
  let engine = enginesByWorkspace.get(key);
  if (!engine) {
    engine = new SequentialThinkingEngine();
    enginesByWorkspace.set(key, engine);
  }
  return engine;
}

/** Test helper — clears all process-local engines. */
export function resetSequentialThinkingEngines(): void {
  enginesByWorkspace.clear();
}
