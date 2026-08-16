export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

// Abort every request after this long so a hung backend can never leave the
// app on the loading screen or a spinner indefinitely.
const REQUEST_TIMEOUT_MS = 15_000;

// Central hook for handling expired/invalid sessions. Registered by AuthContext;
// called once on any HTTP 401 so the app can clear auth state and redirect.
let onUnauthorized: ((isAdminRoute: boolean) => void) | null = null;

export function setUnauthorizedHandler(handler: ((isAdminRoute: boolean) => void) | null) {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  status: number;
  payload: any;
  constructor(status: number, payload: any) {
    super(payload?.error ?? `Request failed (${status})`);
    this.status = status;
    this.payload = payload;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(0, { error: "The request timed out — please try again." });
    }
    throw new ApiError(0, { error: "Network error — check your connection." });
  } finally {
    clearTimeout(timer);
  }
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401) {
      onUnauthorized?.(path.startsWith("/admin"));
    }
    throw new ApiError(res.status, payload);
  }
  return payload as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path, { method: "GET" }),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
};

export function wsUrl(path: string): string {
  const base = API_BASE.replace(/^http/, "ws");
  return `${base}${path}`;
}
