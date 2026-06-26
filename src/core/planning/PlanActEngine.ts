export type ThunderPlan = {
  goal: string;
  assumptions: string[];
  steps: Array<{
    id: string;
    title: string;
    status: 'pending' | 'running' | 'done' | 'blocked' | 'failed';
    files?: string[];
    risk: 'low' | 'medium' | 'high';
  }>;
  requiredApprovals: string[];
};

export type AutonomyPreset = 'safe' | 'guided' | 'builder' | 'pilot' | 'enterprise';

export function parsePlanFromText(text: string): ThunderPlan | null {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[1]) as ThunderPlan;
    if (parsed.goal && Array.isArray(parsed.steps)) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export function isWriteAllowed(mode: string): boolean {
  return mode === 'act';
}

/** Shell commands that only inspect the repo (allowed in plan/review for audits). */
export function isReadOnlyCommand(command: string): boolean {
  const cmd = stripLeadingCd(command).trim();
  if (!cmd) return false;
  const segments = cmd.split(/\s*(?:&&|\|\|?|\;)\s*/).map((part) => part.trim()).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every(isReadOnlyCommandSegment);
}

function isReadOnlyCommandSegment(cmd: string): boolean {
  if (/^(npx\s+)?depcheck\b/i.test(cmd)) return true;
  if (/^npx\s+eslint\b/i.test(cmd)) return true;
  if (/^npm\s+(ls|list|outdated|audit|run\s+(lint|test|typecheck|check|build))\b/i.test(cmd)) return true;
  if (/^yarn\s+(why|list|info|lint|test|build)\b/i.test(cmd)) return true;
  if (/^pnpm\s+(why|list|lint|test|build)\b/i.test(cmd)) return true;
  if (/^(grep|rg|find|cat|head|tail|wc|sort|uniq|ls|tree)\b/i.test(cmd)) return true;
  if (/^git\s+(status|diff|log|ls-files)\b/i.test(cmd)) return true;
  return false;
}

export function stripLeadingCd(command: string): string {
  const match = command.trim().match(/^cd\s+(?:"[^"]+"|'[^']+'|[^\s&;|]+)\s*&&\s*([\s\S]+)$/i);
  return match ? match[1].trim() : command.trim();
}

export function isShellAllowed(mode: string, command?: string): boolean {
  if (mode === 'act') return true;
  if (command && isReadOnlyCommand(command)) return true;
  return false;
}

export function isPatchAllowed(mode: string): boolean {
  return mode === 'act';
}
