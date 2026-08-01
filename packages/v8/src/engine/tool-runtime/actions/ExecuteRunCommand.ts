import type { ToolGrant } from "../../../modules/decision-policy";

import type { ProcessPort } from "../contracts";
import { validateReadonlyCommand } from "../internal/CommandPolicy";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import {
  runCommandInputSchema,
  runCommandOutputSchema,
} from "../internal/ToolCatalog";
import { GrantValidationError } from "./ValidateGrant";

/**
 * Mutating argv-only command execution.
 * Same commandRules / metacharacter policy as run_readonly_command, but
 * requires write workspace effect and explicit grant membership.
 */
export async function executeRunCommand(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  process: ProcessPort;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}): Promise<{
  output: unknown;
  truncated: boolean;
  redacted: boolean;
  timedOut: boolean;
  cancelled: boolean;
}> {
  if (!params.grant.allowedTools.includes("run_command")) {
    throw new GrantValidationError(
      "tool_not_allowed",
      'Tool "run_command" is not in grant.allowedTools.',
    );
  }
  if (params.grant.maximumWorkspaceEffect !== "write") {
    throw new GrantValidationError(
      "effect_not_granted",
      'Tool "run_command" requires write workspace effect.',
    );
  }
  if (!params.grant.allowedEffects.includes("process_execute")) {
    throw new GrantValidationError(
      "effect_not_granted",
      'Tool "run_command" requires effect "process_execute".',
    );
  }
  if (!params.grant.allowedEffects.includes("workspace_write")) {
    throw new GrantValidationError(
      "effect_not_granted",
      'Tool "run_command" requires effect "workspace_write".',
    );
  }

  const input = runCommandInputSchema.parse(params.arguments);
  const validated = validateReadonlyCommand({
    argv: input.argv,
    commandRules: params.grant.commandRules,
  });

  const result = await params.process.execFile({
    argv: validated.argv,
    cwd: params.workspaceRoot,
    env: validated.env,
    timeoutMs: params.timeoutMs,
    maxOutputBytes: Math.min(
      params.maxOutputBytes,
      params.grant.commandRules?.find((rule) =>
        rule.prefixes.includes(validated.matchedPrefix),
      )?.maxOutputBytes ?? params.maxOutputBytes,
    ),
    signal: params.signal,
  });

  const stdout = sanitizeTextOutput(result.stdout, params.maxOutputBytes);
  const stderr = sanitizeTextOutput(
    result.stderr,
    Math.max(1_024, Math.floor(params.maxOutputBytes / 4)),
  );

  const output = runCommandOutputSchema.parse({
    argv: validated.argv,
    exitCode: result.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: result.truncated || stdout.truncated || stderr.truncated,
  });

  return {
    output,
    truncated: output.truncated,
    redacted: stdout.redacted || stderr.redacted,
    timedOut: result.timedOut,
    cancelled: result.cancelled,
  };
}
