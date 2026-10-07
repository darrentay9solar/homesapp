/**
 * Phone notifications in the browser: can this device have them, are they on,
 * and turning them on or off. The server side is api/_routes/alerts.py.
 *
 * iPhone and iPad only allow web notifications for an app added to the Home
 * Screen (iOS 16.4 or later), opened from there — not in a Safari tab.
 */

export type PushState =
  | "unsupported" // this browser can't do web notifications
  | "needs-install" // iPhone/iPad in a Safari tab: add to Home Screen first
  | "server-off" // the server has no VAPID keys yet
  | "blocked" // the person said no; only their browser settings can undo it
  | "off"
  | "on";

export function isIos(ua: string): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** What the device and browser allow, before asking the server anything. */
export function deviceSupport(env: { ua: string; standalone: boolean; hasSW: boolean; hasPush: boolean; hasNotification: boolean }): "ok" | "unsupported" | "needs-install" {
  if (isIos(env.ua) && !env.standalone) return "needs-install";
  if (!env.hasSW || !env.hasPush || !env.hasNotification) return "unsupported";
  return "ok";
}

export function currentSupport(): "ok" | "unsupported" | "needs-install" {
  if (typeof window === "undefined") return "unsupported";
  return deviceSupport({
    ua: navigator.userAgent,
    standalone: isStandalone(),
    hasSW: "serviceWorker" in navigator,
    hasPush: "PushManager" in window,
    hasNotification: "Notification" in window,
  });
}

/** The VAPID public key (base64url) as the bytes PushManager.subscribe wants. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  } catch {
    return null;
  }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Keeps the app icon's badge in step with the unread count, where the device supports badges. */
export function setBadge(unread: number): void {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }) : null;
  try {
    if (unread > 0) void nav?.setAppBadge?.(unread).catch(() => undefined);
    else void nav?.clearAppBadge?.().catch(() => undefined);
  } catch {
    /* not supported */
  }
}
