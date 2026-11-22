import { z } from "zod";
import { memoryFactSchema, type MemoryFact } from "./contracts";
import { redactMemoryContent } from "./internal/privacy";

/** Content boundary shared by capture, storage, graph and prompt consumers. */
export class MemoryContentPolicy {
  public sanitize(text: string): string {
    return redactMemoryContent(z.string().parse(text)).content;
  }

  public fact(input: MemoryFact): MemoryFact {
    const fact = memoryFactSchema.parse(input);
    const strings = (items: string[]) => items.map(value => this.sanitize(value));
    return memoryFactSchema.parse({
      ...fact,
      content: this.sanitize(fact.content),
      ...(fact.title ? { title: this.sanitize(fact.title) } : {}),
      tags: strings(fact.tags), concepts: strings(fact.concepts), files: strings(fact.files),
      source: this.sanitize(fact.source), sourceIds: strings(fact.sourceIds),
      ...(fact.claimKey ? { claimKey: this.sanitize(fact.claimKey) } : {}),
      ...(fact.evidence ? { evidence: fact.evidence.map(row => ({ ...row, id: this.sanitize(row.id) })) } : {}),
    });
  }
}
