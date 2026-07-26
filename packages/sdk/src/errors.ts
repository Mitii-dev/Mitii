import { AgentEngineError } from '@mitii/v8';
import { ZodError } from 'zod';

export const MITII_SDK_ERROR_CODES = [
  'invalid_input',
  'engine_error',
  'unsupported',
  'internal',
] as const;

export type MitiiSdkErrorCode = (typeof MITII_SDK_ERROR_CODES)[number];

/**
 * External-safe SDK error. Messages must not include secrets or full prompts.
 */
export class MitiiSdkError extends Error {
  readonly code: MitiiSdkErrorCode;
  readonly causeDetail?: string;

  constructor(
    code: MitiiSdkErrorCode,
    message: string,
    options?: { cause?: unknown; causeDetail?: string },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'MitiiSdkError';
    this.code = code;
    this.causeDetail = options?.causeDetail;
  }
}

function isAgentEngineError(error: unknown): error is AgentEngineError {
  return error instanceof AgentEngineError;
}

export function mapToSdkError(error: unknown): MitiiSdkError {
  if (error instanceof MitiiSdkError) {
    return error;
  }
  if (isAgentEngineError(error)) {
    const detailCause = error.details?.cause;
    return new MitiiSdkError(
      error.code === 'invalid_input' ? 'invalid_input' : 'engine_error',
      error.message,
      {
        cause: error,
        causeDetail:
          typeof detailCause === 'string' ? detailCause : undefined,
      },
    );
  }
  if (error instanceof ZodError) {
    return new MitiiSdkError(
      'invalid_input',
      'SDK input failed schema validation.',
      {
        cause: error,
        causeDetail: error.issues.map((issue) => issue.message).join('; '),
      },
    );
  }
  return new MitiiSdkError(
    'internal',
    error instanceof Error ? error.message : 'Unknown SDK error.',
    { cause: error },
  );
}
