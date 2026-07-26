import { z } from "zod";

import { DECISION_POLICY_ERROR_CODES } from "../../constants";

export const decisionPolicyErrorCodeSchema = z.enum(
  DECISION_POLICY_ERROR_CODES,
);

export type DecisionPolicyErrorCode = z.infer<
  typeof decisionPolicyErrorCodeSchema
>;

export class DecisionPolicyError extends Error {
  public readonly code: DecisionPolicyErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: DecisionPolicyErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "DecisionPolicyError";
    this.code = code;
    this.details = details;
  }
}
