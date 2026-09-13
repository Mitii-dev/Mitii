import { describe, expect, it } from "vitest";

import {
  InMemoryKnowledgeGraphStore,
  KnowledgeGraphManager,
} from "../graph";

describe("KnowledgeGraphManager", () => {
  it("creates entities/relations and searches with incident edges", async () => {
    const manager = new KnowledgeGraphManager(new InMemoryKnowledgeGraphStore());
    await manager.createEntities([
      {
        name: "Alice",
        entityType: "person",
        observations: ["owns billing"],
      },
      {
        name: "billing",
        entityType: "module",
        observations: ["Stripe webhooks"],
      },
    ]);
    await manager.createRelations([
      { from: "Alice", to: "billing", relationType: "owns" },
    ]);

    const hit = await manager.search("billing");
    expect(hit.entities.map((e) => e.name).sort()).toEqual([
      "Alice",
      "billing",
    ]);
    expect(hit.relations).toHaveLength(1);

    const opened = await manager.open(["Alice"]);
    expect(opened.entities).toHaveLength(1);
    expect(opened.relations[0]?.relationType).toBe("owns");
  });

  it("reports honest deletes and rejects missing relation endpoints", async () => {
    const manager = new KnowledgeGraphManager(new InMemoryKnowledgeGraphStore());
    await manager.createEntities([
      { name: "A", entityType: "x", observations: [] },
    ]);
    await expect(
      manager.createRelations([
        { from: "A", to: "missing", relationType: "depends_on" },
      ]),
    ).rejects.toThrow(/missing/);

    const deleted = await manager.deleteEntities(["A", "nope"]);
    expect(deleted).toEqual({ deleted: ["A"], notFound: ["nope"] });
  });

  it("serializes concurrent mutations without loss", async () => {
    const manager = new KnowledgeGraphManager(new InMemoryKnowledgeGraphStore());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        manager.createEntities([
          {
            name: `E${i}`,
            entityType: "item",
            observations: [`n=${i}`],
          },
        ]),
      ),
    );
    const graph = await manager.read();
    expect(graph.entities).toHaveLength(20);
  });
});
