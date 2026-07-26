import { z } from "zod";

import {
  REPOSITORY_STATE_ERROR_CODES,
} from "../../constants";

export const repositoryStateErrorCodeSchema = z.enum(
  REPOSITORY_STATE_ERROR_CODES,
);

export type RepositoryStateErrorCode = z.infer<
  typeof repositoryStateErrorCodeSchema
>;

export class RepositoryStateError extends Error {
  public readonly code: RepositoryStateErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: RepositoryStateErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "RepositoryStateError";
    this.code = code;
    this.details = details;
  }
}
