import { describe, expect, it } from "vitest";

import { seedExecutionTaskListFromObjective } from "../../helpers/plan";

describe("seedExecutionTaskListFromObjective", () => {
  it("extracts numbered / headed slices from the objective", () => {
    const seeded = seedExecutionTaskListFromObjective(`
Do the following:

1. Desugar nested http.start
2. Add session continuity
3. Scaffold three React cases
`);
    expect(seeded.taskList.purpose).toBe("execution");
    expect(seeded.taskList.source).toBe("agent");
    expect(seeded.taskList.items.length).toBeGreaterThanOrEqual(3);
    expect(seeded.taskList.items[0]?.status).toBe("active");
    expect(seeded.taskList.items[0]?.title).toMatch(/Desugar/i);
    expect(seeded.reasonCodes).toContain("tasklist_seeded_from_objective");
  });

  it("stamps titles from the ask instead of canned fillers", () => {
    const seeded = seedExecutionTaskListFromObjective(
      "please improve the checks package somehow",
    );
    expect(seeded.taskList.items.length).toBeGreaterThanOrEqual(1);
    expect(seeded.taskList.items[0]?.title).toMatch(/checks package/i);
    expect(
      seeded.taskList.items.some((item) =>
        /implement the first safe slice/i.test(item.title),
      ),
    ).toBe(false);
  });
});
