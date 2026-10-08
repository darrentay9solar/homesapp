"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * A screen's sections are tabs, never stacked headings (docs/design/TEMPLATE.md).
 * The open tab lives in the address (?tab=groups), so Back, a refresh and a
 * link from an alert all land on the right one.
 */
export function useTab<T extends string>(values: readonly T[], fallback: T): [T, (t: T) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const raw = params.get("tab");
  const tab = raw && (values as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback(
    (t: T) => {
      const next = new URLSearchParams(params.toString());
      if (t === fallback) next.delete("tab");
      else next.set("tab", t);
      const q = next.toString();
      router.replace(q ? `${path}?${q}` : path, { scroll: false });
    },
    [params, router, path, fallback]
  );
  return [tab, set];
}
