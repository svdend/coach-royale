export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type ApiErrorBody = {
  error: { code: string; message: string };
  request_id: string;
};

export function buildApiErrorBody(
  requestId: string,
  code: string,
  message: string,
): ApiErrorBody {
  return {
    error: { code, message },
    request_id: requestId,
  };
}

export function apiErrorResponse(
  requestId: string,
  code: string,
  message: string,
  status: number,
): Response {
  return new Response(
    JSON.stringify(buildApiErrorBody(requestId, code, message)),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
      },
    },
  );
}
