import { NotFoundError, ValidationError, UnauthorizedError } from './errors';

/** Maps domain errors to HTTP status codes for the API's global error handler. */
export function mapErrorToStatus(error: unknown): number {
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ValidationError) return 400;
  if (error instanceof UnauthorizedError) return 401;
  return 500;
}
