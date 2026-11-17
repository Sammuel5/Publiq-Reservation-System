"use client";

/**
 * The single way admin client components talk to `/api/admin/*`.
 *
 * It never throws: the caller always gets a discriminated result, because a
 * rejected promise inside `onSubmit` is the most common way a form ends up
 * looking frozen with no message. Field errors come back as a map keyed by the
 * same names the inputs use, so they render under the right field.
 */

export type FieldErrors = Record<string, string>;

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; fields: FieldErrors; status: number };

export type AdminFetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

export async function adminFetch<T = Record<string, unknown>>(
  path: string,
  options: AdminFetchOptions = {},
): Promise<ApiResult<T>> {
  const { method = "GET", body, signal } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal,
      credentials: "same-origin",
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      return { ok: false, message: "Cancelled.", fields: {}, status: 0 };
    }
    return {
      ok: false,
      message: "The console could not reach the server. Check your connection and try again.",
      fields: {},
      status: 0,
    };
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; details?: { fields?: FieldErrors } } } | null)
      ?.error;
    return {
      ok: false,
      message: error?.message ?? `Request failed (${response.status}).`,
      fields: error?.details?.fields ?? {},
      status: response.status,
    };
  }

  return { ok: true, data: (payload ?? {}) as T };
}

/** 401 means the session ended mid-shift: send the admin to the login page. */
export function handleUnauthenticated(result: { ok: false; status: number }): boolean {
  if (result.status !== 401) return false;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/admin/login?next=${next}`);
  return true;
}
