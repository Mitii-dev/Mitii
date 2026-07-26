import type { CommandRule } from "../../decision-policy";

import type { ToolReasonCode } from "../contracts";
import { DEFAULT_ALLOWED_COMMAND_ENV } from "../defaults";
import {
  argvMatchesPrefix,
  containsShellMetacharacters,
} from "../policy";

export class CommandPolicyError extends Error {
  public readonly reasonCode: ToolReasonCode;

  constructor(reasonCode: ToolReasonCode, message: string) {
    super(message);
    this.name = "CommandPolicyError";
    this.reasonCode = reasonCode;
  }
}

export interface ValidatedCommand {
  argv: string[];
  env: Record<string, string>;
  matchedPrefix: string;
}

/**
 * Validates an argv-form command against grant commandRules.
 * Rejects shell metacharacters and ambiguous string construction.
 */
export function validateReadonlyCommand(params: {
  argv: unknown;
  commandRules: readonly CommandRule[] | undefined;
  allowShellMetacharacters?: boolean;
}): ValidatedCommand {
  if (!Array.isArray(params.argv) || params.argv.length === 0) {
    throw new CommandPolicyError(
      "invalid_arguments",
      "Command argv must be a non-empty string array.",
    );
  }

  const argv: string[] = [];
  for (const part of params.argv) {
    if (typeof part !== "string" || part.length === 0) {
      throw new CommandPolicyError(
        "invalid_arguments",
        "Each argv element must be a non-empty string.",
      );
    }
    if (part.includes("\0")) {
      throw new CommandPolicyError(
        "command_injection",
        "Command argv contains a null byte.",
      );
    }
    argv.push(part);
  }

  const rules = params.commandRules ?? [];
  if (rules.length === 0) {
    throw new CommandPolicyError(
      "command_not_allowed",
      "No commandRules are granted for process execution.",
    );
  }

  let matched: CommandRule | undefined;
  let matchedPrefix: string | undefined;
  for (const rule of rules) {
    for (const prefix of rule.prefixes) {
      if (argvMatchesPrefix(argv, prefix)) {
        matched = rule;
        matchedPrefix = prefix;
        break;
      }
    }
    if (matched) {
      break;
    }
  }

  if (!matched || !matchedPrefix) {
    throw new CommandPolicyError(
      "command_not_allowed",
      `Command is not covered by granted prefixes: ${argv.join(" ")}`,
    );
  }

  const allowMeta =
    params.allowShellMetacharacters === true ||
    matched.allowShellMetacharacters === true;

  if (!allowMeta) {
    for (const part of argv) {
      if (containsShellMetacharacters(part)) {
        throw new CommandPolicyError(
          "command_injection",
          `Command argument contains shell metacharacters: "${part}"`,
        );
      }
    }
  }

  return {
    argv,
    matchedPrefix,
    env: pickAllowedEnv(process.env),
  };
}

export function pickAllowedEnv(
  source: NodeJS.ProcessEnv,
  allowList: readonly string[] = DEFAULT_ALLOWED_COMMAND_ENV,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of allowList) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }
  return env;
}

export function validateNetworkHost(params: {
  url: string;
  networkHosts: readonly string[] | undefined;
}): { host: string } {
  let parsed: URL;
  try {
    parsed = new URL(params.url);
  } catch {
    throw new CommandPolicyError(
      "invalid_arguments",
      `Invalid URL: "${params.url}"`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CommandPolicyError(
      "network_not_allowed",
      `Unsupported URL protocol: "${parsed.protocol}"`,
    );
  }

  const allowed = params.networkHosts ?? [];
  if (allowed.length === 0) {
    throw new CommandPolicyError(
      "network_not_allowed",
      "No networkHosts are granted.",
    );
  }

  const host = parsed.hostname.toLowerCase();
  const ok = allowed.some((entry) => {
    const normalized = entry.toLowerCase();
    return host === normalized || host.endsWith(`.${normalized}`);
  });

  if (!ok) {
    throw new CommandPolicyError(
      "network_not_allowed",
      `Host "${host}" is not in granted networkHosts.`,
    );
  }

  return { host };
}
