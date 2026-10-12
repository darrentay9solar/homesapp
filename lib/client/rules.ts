/**
 * The rules a form checks before it sends, as the sentence shown under the
 * field when one isn't met (null when it is). Every form in the app follows
 * one pattern: its button stays live, and pressing it with something wrong
 * marks each field in red with its reason and says so above the button,
 * rather than a grey button that doesn't say why. No React here, so it can
 * be unit tested (tests/rules.test.ts).
 */

import { T } from "./i18n";

export const PASSWORD_MIN = 15;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shown above the button when anything on the form needs fixing. */
export const FIX_FIELDS = "Some details are missing or need fixing. See the fields marked in red.";

export function emailProblem(v: string): string | null {
  if (!v.trim()) return T("Enter your email.");
  return EMAIL.test(v.trim()) ? null : T("That email doesn't look right. It should be like you@example.com.");
}

export function nameProblem(v: string, min = 2): string | null {
  return v.trim().length >= min ? null : v.trim() ? T("That name is too short.") : T("Enter your full name.");
}

/** A mobile number's local digits (without the country code). */
export function mobileProblem(local: string): string | null {
  const digits = local.replace(/\D/g, "");
  if (!digits) return T("Enter your mobile number (at least 6 digits).");
  return digits.length >= 6 ? null : T("A mobile number has at least 6 digits.");
}

export function passwordProblem(v: string, min = PASSWORD_MIN): string | null {
  if (!v) return T("Choose a password of at least {n} characters.", { n: min });
  return v.length >= min ? null : T("The password needs at least {n} characters: {left} more to go.", { n: min, left: min - v.length });
}

export function confirmProblem(password: string, confirm: string): string | null {
  if (!confirm) return T("Type the password again.");
  return password === confirm ? null : T("The two passwords don't match.");
}

export function codeProblem(code: string, n = 6): string | null {
  return code.replace(/\D/g, "").length === n ? null : T("Enter all {n} digits of the code.", { n });
}

/** Free text that needs a few words (a reason, a note). */
export function textProblem(v: string, min: number, what: string): string | null {
  const len = v.trim().length;
  if (!len) return T("Enter {what}.", { what });
  return len >= min ? null : T("Write a little more: at least {n} characters ({left} more).", { n: min, left: min - len });
}

export function requiredProblem(v: string | null | undefined, what: string): string | null {
  return v && String(v).trim() ? null : T("Choose {what}.", { what });
}

/** The first problem among several (for a form's summary line), or null when all is well. */
export function firstProblem(...ps: Array<string | null | undefined>): string | null {
  return ps.find(Boolean) ?? null;
}

/** Optional: empty is fine; otherwise six digits. */
export function postalProblem(v: string): string | null {
  return !v.trim() || /^\d{6}$/.test(v.trim()) ? null : T("A Singapore postal code is 6 digits.");
}

/** Optional: empty is fine; otherwise the NRIC's last four, e.g. 567D. */
export function icLast4Problem(v: string): string | null {
  return !v.trim() || /^\d{3}[A-Za-z]$/.test(v.trim()) ? null : T("NRIC last 4 should be three digits and a letter, e.g. 567D.");
}
