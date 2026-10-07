"use client";

import IosShareRoundedIcon from "@mui/icons-material/IosShareRounded";
import NotificationsActiveRoundedIcon from "@mui/icons-material/NotificationsActiveRounded";
import NotificationsOffRoundedIcon from "@mui/icons-material/NotificationsOffRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";

import { ApiError, useFetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { currentSubscription, currentSupport, keyBytes, type PushState, registration } from "@/lib/client/push";

import { T, TR } from "@/lib/client/i18n";
const COPY: Record<PushState, { title: string; text: string }> = {
  on: { title: "Alerts reach this phone", text: "You'll get a notification here for everything on this screen, even when the app is closed." },
  off: { title: "Get alerts on this phone", text: "Turn on notifications to hear about approvals, site visits and crews running late, even when the app is closed." },
  blocked: { title: "Notifications are blocked", text: "This browser was told not to show them. Allow notifications for this site in the browser's settings, then come back." },
  "needs-install": { title: "Add the app to your Home Screen first", text: "On iPhone and iPad, notifications only work for the installed app: tap Share, then “Add to Home Screen”, and open GetHomeApps from there." },
  unsupported: { title: "This browser can't show notifications", text: "Use Chrome on Android, Safari on iPhone (from the Home Screen), or a desktop browser." },
  "server-off": { title: "Phone notifications aren't set up yet", text: "The server needs its notification keys (VAPID) first. Alerts still appear here." },
};

/**
 * Turning phone notifications on or off for this device. The same alerts as
 * the Alerts screen: one list, two places to see it.
 */
export function PushSetup({ compact = false }: { compact?: boolean }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [state, setState] = useState<PushState | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const support = currentSupport();
    if (support !== "ok") return setState(support);
    try {
      const k = await fetcher<{ publicKey: string | null }>("/push/key");
      setKey(k.publicKey);
      if (!k.publicKey) return setState("server-off");
      if (Notification.permission === "denied") return setState("blocked");
      const sub = await currentSubscription();
      if (sub) {
        // Make sure the server still has it (it may have been cleared); quietly re-send.
        await fetcher("/push/subscriptions", { method: "POST", json: sub.toJSON() }).catch(() => undefined);
      }
      setState(sub ? "on" : "off");
    } catch {
      setState("unsupported");
    }
  }, [fetcher]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the device's state once, after mount
    void check();
  }, [check]);

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await registration();
      if (!reg || !key) throw new Error("This browser couldn't start notifications.");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      const r = await fetcher<{ message: string }>("/push/subscriptions", { method: "POST", json: sub.toJSON() });
      toast(r.message);
      setState("on");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Couldn't turn notifications on.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      const sub = await currentSubscription();
      if (sub) {
        await fetcher("/push/subscriptions", { method: "DELETE", json: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      toast("Notifications are off for this device.");
      setState("off");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn notifications off.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetcher<{ message: string }>("/push/test", { method: "POST" });
      toast(r.message);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The test didn't send.");
    } finally {
      setBusy(false);
    }
  }

  if (!state || (compact && state === "on")) return null;
  const on = state === "on";
  const c = COPY[state];
  return (
    <Card sx={{ p: 2, mt: 2 }} data-testid="push-setup">
      <Stack direction="row" sx={{ gap: 1.5, alignItems: "flex-start" }}>
        <Box sx={{ width: 40, height: 40, flex: "0 0 auto", borderRadius: `${DESIGN.radius.iconTile}px`, display: "grid", placeItems: "center", bgcolor: on ? "success.main" : "action.hover", color: on ? "#fff" : "primary.main" }}>
          {state === "needs-install" ? <IosShareRoundedIcon /> : state === "blocked" || state === "unsupported" ? <NotificationsOffRoundedIcon /> : <NotificationsActiveRoundedIcon />}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }}>{TR(c.title)}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25 }}>
            {TR(c.text)}
          </Typography>
        </Box>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {error}
        </Alert>
      )}
      {(state === "off" || on) && (
        <Stack direction="row" sx={{ gap: 1, mt: 1.75, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {on ? (
            <>
              <Button disabled={busy} onClick={() => void test()}>
                {T("Send a test")}
              </Button>
              <Button disabled={busy} color="inherit" onClick={() => void turnOff()}>
                {T("Turn off")}
              </Button>
            </>
          ) : (
            <Button variant="contained" disabled={busy} onClick={() => void turnOn()} data-testid="push-on">
              {busy ? T("Turning on…") : T("Turn on notifications")}
            </Button>
          )}
        </Stack>
      )}
    </Card>
  );
}
