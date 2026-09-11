import { describe, expect, it } from "vitest";

import {
  canFetchUrlPerRobots,
  parseRobots,
  robotsTxtUrlFor,
} from "../RobotsPolicy";
import { selectLineWindow } from "../readFileWindow";

describe("RobotsPolicy", () => {
  it("builds robots.txt URL from target", () => {
    expect(robotsTxtUrlFor("https://docs.example.com/a/b")).toBe(
      "https://docs.example.com/robots.txt",
    );
  });

  it("allows when robots is empty or has no matching disallow", () => {
    expect(
      canFetchUrlPerRobots({
        robotsTxt: "",
        targetUrl: "https://example.com/page",
        userAgent: "MitiiBot/1.0",
      }),
    ).toBe(true);
  });

  it("denies paths matching Disallow for matching UA", () => {
    const robots = `
User-agent: *
Disallow: /private
Allow: /private/public
`;
    expect(
      canFetchUrlPerRobots({
        robotsTxt: robots,
        targetUrl: "https://example.com/private/secret",
        userAgent: "MitiiBot/1.0",
      }),
    ).toBe(false);
    expect(
      canFetchUrlPerRobots({
        robotsTxt: robots,
        targetUrl: "https://example.com/private/public/ok",
        userAgent: "MitiiBot/1.0",
      }),
    ).toBe(true);
  });

  it("parseRobots groups agents", () => {
    const parsed = parseRobots(`
User-agent: Googlebot
User-agent: MitiiBot
Disallow: /nogo
`);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]?.agents).toContain("mitiibot");
  });
});

describe("selectLineWindow head/tail", () => {
  const text = ["a", "b", "c", "d", "e"].join("\n");

  it("tailLines returns last N lines", () => {
    const window = selectLineWindow({
      text,
      tailLines: 2,
      textIsComplete: true,
    });
    expect(window.content).toBe("d\ne");
    expect(window.startLine).toBe(4);
    expect(window.endLine).toBe(5);
    expect(window.eof).toBe(true);
  });

  it("maxLines from start acts as head", () => {
    const window = selectLineWindow({
      text,
      startLine: 1,
      maxLines: 2,
      textIsComplete: true,
    });
    expect(window.content).toBe("a\nb");
    expect(window.startLine).toBe(1);
    expect(window.endLine).toBe(2);
  });
});
