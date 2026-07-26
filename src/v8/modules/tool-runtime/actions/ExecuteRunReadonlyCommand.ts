import type { ToolGrant } from "../../decision-policy";

import type { ProcessPort } from "../contracts";
import { validateReadonlyCommand } from "../internal/CommandPolicy";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import {
  runReadonlyCommandInputSchema,
  runReadonlyCommandOutputSchema,
} from "../internal/ToolCatalog";

export async function executeRunReadonlyCommand(params: {
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
  const input = runReadonlyCommandInputSchema.parse(params.arguments);
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

  const output = runReadonlyCommandOutputSchema.parse({
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
