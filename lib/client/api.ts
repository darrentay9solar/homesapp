"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";

import { currentLang, translate } from "./i18n";

/**
 * Talking to the Python API from the browser.
 *
 * Every call carries the Clerk session token as a Bearer header. getToken()
 * returns a fresh one (they live about a minute), so a tab left open all
 * morning still works. Errors come back as ApiError with the server's
 * message, which is written to be shown to people.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Fetcher = <T = unknown>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;

/**
 * Development only: the account a project manager is testing as ("act as").
 * Kept for this browser tab; the API ignores it anywhere but a laptop.
 */
export const ACT_AS_KEY = "gha-act-as";
export function actingAs(): string | null {
  try {
    return sessionStorage.getItem(ACT_AS_KEY);
  } catch {
    return null;
  }
}

export function useFetcher(): Fetcher {
  const { getToken } = useAuth();
  return useCallback(
    async <T,>(path: string, init: RequestInit & { json?: unknown } = {}) => {
      const token = await getToken();
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const as = actingAs();
      if (as) headers.set("X-Act-As", as);
      let body = init.body;
      if (init.json !== undefined) {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(init.json);
      }
      const res = await fetch(`/api/py${path}`, { ...init, headers, body, cache: "no-store" });
      const text = await res.text();
      const data = text ? safeJson(text) : null;
      if (!res.ok) {
        const serverMessage =
          data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : "";
        const message = serverMessage || `Request failed (${res.status})`;
        // The server writes in English; shown in the person's language.
        throw new ApiError(translate(message, currentLang()), res.status);
      }
      return data as T;
    },
    [getToken]
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 200) };
  }
}

/** Loads `path` (null = don't load yet) and exposes reload(). */
export function useApi<T>(path: string | null) {
  const fetcher = useFetcher();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const seq = useRef(0);

  // Results are applied only if no newer request has started, so a slow
  // response can never overwrite a fresher one.
  const run = useCallback(
    (p: string) => {
      const mine = ++seq.current;
      return fetcher<T>(p).then(
        (result) => {
          if (mine === seq.current) {
            setData(result);
            setError(null);
          }
        },
        (err: unknown) => {
          if (mine === seq.current) setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
        }
      );
    },
    [fetcher]
  );

  useEffect(() => {
    if (path) void run(path);
  }, [run, path]);

  const reload = useCallback(async () => {
    if (path) await run(path);
  }, [run, path]);

  const loading = path !== null && data === null && error === null;
  return { data, error, loading, reload, setData };
}
