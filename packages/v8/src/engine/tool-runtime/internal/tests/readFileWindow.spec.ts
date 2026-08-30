import { describe, expect, it } from "vitest";

import {
  clipLineWindowToCharBudget,
  deriveMaxLinesFromCharBudget,
  selectLineWindow,
} from "../readFileWindow";

describe("selectLineWindow", () => {
  const text = ["L1", "L2", "L3", "L4", "L5"].join("\n");

  it("returns the full file when no limits apply", () => {
    const window = selectLineWindow({ text, textIsComplete: true });
    expect(window).toMatchObject({
      content: text,
      startLine: 1,
      endLine: 5,
      totalLines: 5,
      eof: true,
      truncated: false,
    });
    expect(window.nextStartLine).toBeUndefined();
  });

  it("honors startLine/endLine and exposes nextStartLine", () => {
    const window = selectLineWindow({
      text,
      startLine: 2,
      endLine: 3,
      textIsComplete: true,
    });
    expect(window.content).toBe("L2\nL3");
    expect(window.startLine).toBe(2);
    expect(window.endLine).toBe(3);
    expect(window.truncated).toBe(true);
    expect(window.truncationReason).toBe("line_range");
    expect(window.nextStartLine).toBe(4);
    expect(window.eof).toBe(false);
  });

  it("clips on line boundaries for maxChars and sets model_budget", () => {
    const window = selectLineWindow({
      text,
      maxChars: 5, // "L1\nL2" is 5 chars
      textIsComplete: true,
    });
    expect(window.content).toBe("L1\nL2");
    expect(window.startLine).toBe(1);
    expect(window.endLine).toBe(2);
    expect(window.nextStartLine).toBe(3);
    expect(window.truncationReason).toBe("model_budget");
    expect(window.eof).toBe(false);
  });

  it("marks byte_cap when text is incomplete", () => {
    const window = selectLineWindow({
      text: "L1\nL2",
      textIsComplete: false,
    });
    expect(window.truncated).toBe(true);
    expect(window.truncationReason).toBe("byte_cap");
    expect(window.nextStartLine).toBe(3);
    expect(window.eof).toBe(false);
  });
});

describe("clipLineWindowToCharBudget", () => {
  it("rewrites endLine/nextStartLine without mid-line cuts when possible", () => {
    const clipped = clipLineWindowToCharBudget(
      {
        content: "aaaa\nbbbb\ncccc",
        startLine: 10,
        endLine: 12,
        totalLines: 20,
        eof: false,
        nextStartLine: 13,
        truncated: true,
        truncationReason: "line_range",
      },
      9, // "aaaa\nbbbb" = 9
    );
    expect(clipped.content).toBe("aaaa\nbbbb");
    expect(clipped.startLine).toBe(10);
    expect(clipped.endLine).toBe(11);
    expect(clipped.nextStartLine).toBe(12);
    expect(clipped.truncationReason).toBe("model_budget");
  });
});

describe("deriveMaxLinesFromCharBudget", () => {
  it("scales with the character budget", () => {
    expect(deriveMaxLinesFromCharBudget(6000)).toBeGreaterThanOrEqual(16);
    expect(deriveMaxLinesFromCharBudget(100)).toBe(16);
  });
});
