export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const bodyText = await response.text();
  const payload = bodyText ? (JSON.parse(bodyText) as T) : ({} as T);

  if (!response.ok) {
    let message: string | undefined;
    if (typeof payload === "object" && payload !== null && "error" in payload) {
      const errField = (payload as { error: unknown }).error;
      if (typeof errField === "string") {
        message = errField;
      } else if (
        typeof errField === "object" &&
        errField !== null &&
        "message" in errField &&
        typeof (errField as { message: unknown }).message === "string"
      ) {
        message = (errField as { message: string }).message;
      }
    }
    throw new Error(message ?? `Request failed (${response.status})`);
  }

  return payload;
}
