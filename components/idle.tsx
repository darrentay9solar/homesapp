"use client";

import { useClerk } from "@clerk/nextjs";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useRef, useState } from "react";

import { MDialog } from "@/components/m";
import { T } from "@/lib/client/i18n";

const IDLE_MS = 30 * 60_000;
const WARN_MS = 60_000;
const KEY = "gha-last-active";

function lastActive(mine: number): number {
  try {
    return Math.max(mine, Number(localStorage.getItem(KEY)) || 0);
  } catch {
    return mine;
  }
}

/**
 * Staff are signed out after 30 minutes without using the app, with a minute's
 * warning (ISO 27001 A.8.5): they can see many customers' records, often on
 * shared or office computers. Using it in any tab keeps every tab signed in.
 */
export function IdleSignOut() {
  const { signOut } = useClerk();
  const [warn, setWarn] = useState(false);
  const last = useRef(0);
  const saved = useRef(0);

  const active = useCallback(() => {
    const now = Date.now();
    last.current = now;
    // Shared with other tabs, at most every 10 seconds.
    if (now - saved.current > 10_000) {
      saved.current = now;
      try {
        localStorage.setItem(KEY, String(now));
      } catch {
        // private browsing: this tab alone counts
      }
    }
  }, []);

  useEffect(() => {
    active(); // opening the app counts
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const e of events) window.addEventListener(e, active, { passive: true });
    const timer = setInterval(() => {
      const idle = Date.now() - lastActive(last.current);
      if (idle >= IDLE_MS) {
        clearInterval(timer);
        void signOut({ redirectUrl: "/sign-in" });
      } else {
        setWarn(idle >= IDLE_MS - WARN_MS);
      }
    }, 5_000);
    return () => {
      for (const e of events) window.removeEventListener(e, active);
      clearInterval(timer);
    };
  }, [active, signOut]);

  if (!warn) return null;
  return (
    <MDialog
      title={T("Still there?")}
      onClose={() => {
        active();
        setWarn(false);
      }}
    >
      <Typography sx={{ color: "text.secondary", mb: 3 }}>{T("To keep customers' data safe, you'll be signed out in a minute unless you carry on.")}</Typography>
      <Button
        variant="contained"
        size="large"
        fullWidth
        onClick={() => {
          active();
          setWarn(false);
        }}
        data-testid="idle-stay"
      >
        {T("Stay signed in")}
      </Button>
    </MDialog>
  );
}
