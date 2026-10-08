"use client";

import { useEffect, useRef } from "react";

import { useFetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { type Sent, shouldSend } from "@/lib/client/location";

/** When this phone last sent its position, for the Settings row ("last sent …"). */
let lastSentAt: number | null = null;
export function lastShared(): number | null {
  return lastSentAt;
}

/**
 * While someone shares their location (Account → Settings), sends this
 * phone's position to the server: straight away, then every couple of
 * minutes or after moving 100 m, only while GetHomeApps is open. A web app
 * can't do it in the background; the Settings row says so. Never while a PM
 * is testing as someone else: this phone is theirs, not the other person's.
 */
export function LocationSharer() {
  const { me } = useApp();
  const fetcher = useFetcher();
  const last = useRef<Sent>(null);
  const on = Boolean(me?.settings?.shareLocation) && !me?.actingAs && me?.state === "active";

  useEffect(() => {
    if (!on || typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    let stopped = false;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
        const now = Date.now();
        if (stopped || !shouldSend(last.current, fix, now)) return;
        last.current = { at: now, pos: fix };
        void fetcher("/me/location", { method: "PUT", json: fix })
          .then(() => {
            lastSentAt = now;
          })
          .catch(() => {
            // Turned off elsewhere, or offline: try again with the next fix.
            last.current = null;
          });
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 60_000 }
    );
    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(id);
    };
  }, [on, fetcher]);

  return null;
}
