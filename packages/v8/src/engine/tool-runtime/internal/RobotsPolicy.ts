/**
 * Lightweight robots.txt gate for autonomous fetch (servers-main fetch technique).
 * No external Protego dependency — parses User-agent / Allow / Disallow groups.
 */

export const AUTONOMOUS_FETCH_USER_AGENT =
  "MitiiBot/1.0 (Autonomous; +https://mitii.dev)";
export const USER_INITIATED_FETCH_USER_AGENT =
  "MitiiBot/1.0 (User-Specified; +https://mitii.dev)";

export type FetchIntent = "autonomous" | "user";

export class RobotsDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RobotsDeniedError";
  }
}

export function robotsTxtUrlFor(targetUrl: string): string {
  const parsed = new URL(targetUrl);
  return `${parsed.protocol}//${parsed.host}/robots.txt`;
}

/**
 * Parse robots.txt and decide whether `userAgent` may fetch `targetUrl`.
 * Missing/empty robots → allow. 401/403 on robots fetch → deny (caller).
 * Other 4xx on robots → allow (same as servers-main fetch).
 */
export function canFetchUrlPerRobots(params: {
  robotsTxt: string;
  targetUrl: string;
  userAgent: string;
}): boolean {
  const rules = parseRobots(params.robotsTxt);
  const path = new URL(params.targetUrl).pathname || "/";
  const ua = params.userAgent.toLowerCase();

  const matchingGroups = rules.groups.filter((group) =>
    group.agents.some(
      (agent) => agent === "*" || ua.includes(agent) || agent.includes(ua),
    ),
  );
  const groups =
    matchingGroups.length > 0
      ? matchingGroups
      : rules.groups.filter((group) => group.agents.includes("*"));

  if (groups.length === 0) {
    return true;
  }

  // Longest matching Allow/Disallow wins (common robots semantics).
  let best: { allow: boolean; length: number } | undefined;
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!pathMatchesRobotsPrefix(path, rule.prefix)) {
        continue;
      }
      const length = rule.prefix.length;
      if (!best || length > best.length) {
        best = { allow: rule.allow, length };
      }
    }
  }
  return best ? best.allow : true;
}

interface RobotsRule {
  allow: boolean;
  prefix: string;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

interface ParsedRobots {
  groups: RobotsGroup[];
}

export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      const agent = value.toLowerCase();
      if (!current || current.rules.length > 0) {
        current = { agents: [agent], rules: [] };
        groups.push(current);
      } else {
        current.agents.push(agent);
      }
      continue;
    }

    if (!current) continue;
    if (key === "disallow") {
      current.rules.push({ allow: false, prefix: value || "/" });
    } else if (key === "allow") {
      current.rules.push({ allow: true, prefix: value || "/" });
    }
  }

  return { groups };
}

function pathMatchesRobotsPrefix(path: string, prefix: string): boolean {
  if (prefix === "") {
    // Empty Disallow means allow all for that agent in many parsers.
    return false;
  }
  if (prefix === "/") {
    return true;
  }
  return path === prefix || path.startsWith(prefix);
}
