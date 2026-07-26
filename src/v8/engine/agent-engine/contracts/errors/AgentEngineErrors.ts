import { z } from "zod";

import { AGENT_ERROR_CODES } from "../../constants";

export const agentEngineErrorCodeSchema = z.enum(AGENT_ERROR_CODES);

export type AgentEngineErrorCode = z.infer<typeof agentEngineErrorCodeSchema>;

export class AgentEngineError extends Error {
  public readonly code: AgentEngineErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: AgentEngineErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "AgentEngineError";
    this.code = code;
    this.details = details;
  }
}
