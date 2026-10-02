/**
 * Reports whether Clerk is configured, without requiring a signed-in user.
 *
 * Deliberately inspects configuration rather than calling Clerk's API: the
 * health endpoint is public (the middleware exempts it) and an uptime monitor
 * cannot authenticate. Mis-set keys are the realistic failure here — a wrong
 * environment's key, or a secret key pasted into the publishable slot — and
 * those are all visible from the key strings themselves.
 */

export type AuthCheck =
  | {
      ok: true;
      /** "development" or "production" — Clerk encodes this in the key prefix. */
      instance: string;
      publishableKeyPrefix: string;
      secretKeySet: true;
    }
  | { ok: false; error: string; hint: string };

export function checkAuth(): AuthCheck {
  const publishable = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  const secret = process.env.CLERK_SECRET_KEY?.trim() ?? "";

  if (!publishable && !secret) {
    return {
      ok: false,
      error: "Clerk keys are not set.",
      hint:
        "Add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to .env.local, " +
        "and to Vercel for all three environments.",
    };
  }
  if (!publishable) {
    return {
      ok: false,
      error: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing.",
      hint: "Copy it from Clerk → Configure → API Keys. It starts with pk_.",
    };
  }
  if (!secret) {
    return {
      ok: false,
      error: "CLERK_SECRET_KEY is missing.",
      hint: "Copy it from Clerk → Configure → API Keys. It starts with sk_.",
    };
  }

  // Swapping these is an easy mistake and produces baffling runtime errors.
  if (!publishable.startsWith("pk_")) {
    return {
      ok: false,
      error: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY does not start with pk_.",
      hint: secret.startsWith("pk_")
        ? "The two keys look swapped — the pk_ value belongs in the publishable variable."
        : "Check you copied the publishable key, not the secret or the frontend API URL.",
    };
  }
  if (!secret.startsWith("sk_")) {
    return {
      ok: false,
      error: "CLERK_SECRET_KEY does not start with sk_.",
      hint: "Check you copied the secret key, not the publishable one.",
    };
  }

  const pkInstance = publishable.startsWith("pk_live_") ? "production" : "development";
  const skInstance = secret.startsWith("sk_live_") ? "production" : "development";

  // A live publishable key with a test secret (or vice versa) fails in ways
  // that look like a session bug rather than a configuration error.
  if (pkInstance !== skInstance) {
    return {
      ok: false,
      error: `Key mismatch: publishable is ${pkInstance}, secret is ${skInstance}.`,
      hint: "Both keys must come from the same Clerk instance. Re-copy them together.",
    };
  }

  return {
    ok: true,
    instance: pkInstance,
    // Enough to tell two Clerk apps apart; not enough to be useful to anyone else.
    publishableKeyPrefix: publishable.slice(0, 11),
    secretKeySet: true,
  };
}
