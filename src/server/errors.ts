/** An error that maps to an HTTP status and an ApiErrorBody. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} was not found`);
export const badRequest = (message: string, details?: unknown) => new ApiError(400, 'validation', message, details);
export const conflict = (message: string) => new ApiError(409, 'conflict', message);
export const upstreamError = (message: string, details?: unknown) => new ApiError(502, 'upstream', message, details);
