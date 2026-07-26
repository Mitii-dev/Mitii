import type { MemoryService } from './MemoryService';
import type { ContextItem } from '../../../features/ce/context/types';

/**
 * claude-mem style passive memory injection — surfaces relevant memories
 * without requiring the agent to call memory_search.
 */
export class PassiveMemoryInjector {
  constructor(private readonly memoryService?: MemoryService) {}

  async inject(query: string, sessionId?: string): Promise<ContextItem[]> {
    if (!this.memoryService) return [];

    const observations = await this.memoryService.searchAsync(query, 5);
    const sessionRecent = sessionId
      ? this.memoryService.recent(3).filter((o) => o.sessionId === sessionId)
      : [];

    const seen = new Set<number>();
    const merged = [...observations, ...sessionRecent].filter((o) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });

    return merged.map((obs) => ({
      id: `passive-memory-${obs.id}`,
      source: 'memory',
      content: `[${obs.type}] ${obs.text}`,
      score: obs.type === 'decision' || obs.type === 'user_preference' ? 6 : 4,
      reason: `Passive memory (${obs.type})`,
      tokenEstimate: Math.ceil(obs.text.length / 4),
    }));
  }
}
