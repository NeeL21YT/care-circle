/** Browser-side API helper. All mutations go through here. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body || init.formData ? "POST" : "GET"),
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
      body: init.formData ?? (init.body ? JSON.stringify(init.body) : undefined),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "network", "We could not reach the server. Check your internet connection and try again.");
  }
  let json: { data?: T; error?: { code: string; message: string; fields?: Record<string, string> } } = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON error */
  }
  if (!res.ok) {
    const e = json.error;
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? "Something went wrong. Please try again.", e?.fields);
  }
  return json.data as T;
}

export function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

/** Short random id for idempotent offline-safe writes. */
export function clientEventId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
