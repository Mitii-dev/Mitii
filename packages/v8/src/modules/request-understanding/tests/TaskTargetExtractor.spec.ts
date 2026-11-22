import { describe, expect, it } from "vitest";

import { TaskTargetExtractor } from "../task-analyzer/analyzer/TaskTargetExtractor";

describe("TaskTargetExtractor file cites", () => {
  const extractor = new TaskTargetExtractor();

  it("does not treat Class.method / this.property as C source files", () => {
    const prompts = [
      "AppService.createUser returns a raw string — refactor it.",
      "CartService.checkoutCart references this.ordersService.",
      "OrdersService.convertCartToOrder references this.cartRepository.",
      "ProductsController.discontinueProductRoute calls this.productsService.discontinueProduct.",
    ];

    for (const prompt of prompts) {
      const files = extractor
        .extract(prompt)
        .filter((target) => target.kind === "file")
        .map((target) => target.value);
      expect(files.some((value) => /\.(?:c|h)$/i.test(value))).toBe(false);
    }
  });

  it("still extracts real C/H sources", () => {
    const targets = extractor.extract(
      "Fix the buffer overflow in main.c and helpers.h.",
    );
    expect(
      targets.some((target) => target.kind === "file" && target.value === "main.c"),
    ).toBe(true);
    expect(
      targets.some(
        (target) => target.kind === "file" && target.value === "helpers.h",
      ),
    ).toBe(true);
  });

  it("keeps .github workflow paths and normalizes bare github/ cites", () => {
    const dotted = extractor.extract(
      "Add a GitHub Actions workflow at .github/workflows/ci.yml that runs on pull_request.",
    );
    expect(
      dotted.some(
        (target) =>
          target.kind === "file" &&
          target.value === ".github/workflows/ci.yml" &&
          target.explicit,
      ),
    ).toBe(true);
    expect(
      dotted.some(
        (target) =>
          target.kind === "file" && target.value === "github/workflows/ci.yml",
      ),
    ).toBe(false);

    const bare = extractor.extract(
      "Update github/workflows/ci.yml to run tests.",
    );
    expect(
      bare.some(
        (target) =>
          target.kind === "file" && target.value === ".github/workflows/ci.yml",
      ),
    ).toBe(true);
  });
});
