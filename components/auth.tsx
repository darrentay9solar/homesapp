"use client";

import { useRouter } from "next/navigation";
import { type ClipboardEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { DESIGN } from "@/lib/client/design";

import { I, Logo } from "./icons";
import { SkyScene } from "./sky-scene";
import { COUNTRIES, joinPhone, splitPhone } from "./phone-input";
import { ThemeButton } from "./theme-button";

/**
 * The account screens' frame.
 *
 *  - Phones: the approved template — wavy green header with back and title,
 *    then a centred column, full screen.
 *  - Tablets: the same, as a centred card.
 *  - Desktop: a split screen. The green panel moves to the left as the
 *    brand side (logo, tagline, what the app does); the form sits on the
 *    right with its own back link and heading, left-aligned like a
 *    standard desktop sign-in page.
 */
export function AuthShell({
  title,
  back,
  compact,
  children,
}: {
  title: string;
  back?: string | (() => void);
  /** Desktop: a narrower, centred column for longer forms (Create Account). */
  compact?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const goBack = back ? () => (typeof back === "string" ? router.push(back) : back()) : null;
  return (
    <main className={`auth${compact ? " compact" : ""}`}>
      <div className="auth-main">
      {/* Desktop only: the green brand panel's soft waves behind the form card. */}
      <svg className="mainwaves" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <circle cx="560" cy="90" r="210" fill="rgba(255,255,255,.06)" />
        <path d="M0 640C120 590 220 670 340 630S520 550 600 590V900H0Z" fill="rgba(255,255,255,.07)" />
        <path d="M0 730C140 690 250 760 380 720S540 670 600 700V900H0Z" fill="rgba(255,255,255,.07)" />
      </svg>
      <div className="card-auth">
        <div className="deskbar">
          {/* Desktop has no green header, so its back arrow sits here, beside the logo. */}
          {goBack && (
            <button className="icobtn deskback" aria-label="Back" onClick={goBack}>
              <I.back size={20} />
            </button>
          )}
          <span className="deskbrand">
            <span className="deskmark">
              <Logo size={36} />
            </span>
            <span>
              <b>GETHOMEAPPS</b>
              <small>9 SOLAR HOME · 九太阳家</small>
            </span>
          </span>
          <ThemeButton />
        </div>
        <div className="band">
          {/* Left edge lower, right edge higher — as in the template. */}
          <svg className="wave" viewBox="0 0 440 176" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="authBandFill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={DESIGN.green.header} />
                <stop offset="1" stopColor={DESIGN.green.mid} />
              </linearGradient>
            </defs>
            <path d="M0 0H440V96C380 132 320 118 244 122C156 127 76 140 0 172Z" fill="url(#authBandFill)" />
          </svg>
          <div className="topbar">
            {goBack ? (
              <button className="navbtn" aria-label="Back" onClick={goBack}>
                <I.back size={20} />
              </button>
            ) : (
              <span style={{ width: 40 }} />
            )}
            <h1>{title}</h1>
            <ThemeButton />
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
      </div>
      {/* Desktop only: the animated sky on the left. */}
      <aside className="auth-side" aria-hidden="true">
        <SkyScene />
      </aside>
    </main>
  );
}


export function Mark() {
  return (
    <div className="mark">
      <Logo size={46} />
    </div>
  );
}

export function AuthField({
  label,
  icon,
  error,
  ...input
}: {
  label: string;
  icon?: (p: { size?: number }) => ReactNode;
  error?: string | null;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const Icon = icon;
  return (
    <>
      <div className={`af ${error ? "bad" : ""}`}>
        <label htmlFor={input.id}>{label}</label>
        {Icon && <Icon />}
        <input {...input} aria-invalid={Boolean(error)} />
      </div>
      {error && <div className="fielderr">{error}</div>}
    </>
  );
}

export function PasswordField({
  label,
  error,
  ...input
}: { label: string; error?: string | null } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <div className={`af ${error ? "bad" : ""}`}>
        <label htmlFor={input.id}>{label}</label>
        <I.lock />
        <input {...input} type={shown ? "text" : "password"} aria-invalid={Boolean(error)} />
        <button
          type="button"
          className="eye"
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? <I.eyeOff size={17} /> : <I.eye size={17} />}
        </button>
      </div>
      {error && <div className="fielderr">{error}</div>}
    </>
  );
}

/** Mobile with a compact country picker, in the template's field style. */
export function AuthPhoneField({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  const [dial, setDial] = useState(() => splitPhone(value).dial);
  const { local } = splitPhone(value);
  return (
    <>
      <div className={`af ${error ? "bad" : ""}`}>
        <label htmlFor={id}>Mobile</label>
        <span className="cc">
          {COUNTRIES.find((c) => c.dial === dial)?.code} +{dial} ▾
          <select
            aria-label="Country code"
            value={dial}
            onChange={(e) => {
              setDial(e.target.value);
              onChange(joinPhone(e.target.value, local));
            }}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.dial}>
                {c.name} (+{c.dial})
              </option>
            ))}
          </select>
        </span>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={dial === "65" ? "9123 4567" : "Mobile number"}
          value={local}
          onChange={(e) => onChange(joinPhone(dial, e.target.value.replace(/^\+/, "")))}
        />
      </div>
      {error && <div className="fielderr">{error}</div>}
    </>
  );
}

/** Six boxes; typing advances, backspace goes back, pasting a code fills all six. */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  length?: number;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  function set(next: string) {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    refs.current[Math.min(clean.length, length - 1)]?.focus();
  }

  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      set(value.slice(0, i - 1));
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    set(e.clipboardData.getData("text"));
  }

  return (
    <div className="otp" role="group" aria-label="Verification code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={length}
          aria-label={`Digit ${i + 1}`}
          value={d}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={onPaste}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, "");
            if (!typed) return set(value.slice(0, i));
            // A phone's one-time-code autofill can drop all six into one box.
            if (typed.length > 1) return set(value.slice(0, i) + typed);
            set(value.slice(0, i) + typed + value.slice(i + 1));
          }}
        />
      ))}
    </div>
  );
}

/** "Resend in 0:42", then a link. */
export function ResendCode({ onResend }: { onResend: () => Promise<void> }) {
  const [left, setLeft] = useState(45);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <div className="alt" style={{ margin: "6px 0 22px" }}>
      Didn&apos;t receive it?{" "}
      {left > 0 ? (
        <span>Resend in 0:{String(left).padStart(2, "0")}</span>
      ) : (
        <button
          type="button"
          onClick={async () => {
            setLeft(45);
            await onResend();
          }}
        >
          Resend
        </button>
      )}
    </div>
  );
}

/** Clerk errors, as one sentence a person can act on. */
export function clerkMessage(err: unknown): string {
  const e = err as { errors?: Array<{ longMessage?: string; message?: string; code?: string }>; longMessage?: string; message?: string; code?: string } | null;
  const first = e?.errors?.[0];
  const code = first?.code ?? e?.code;
  const friendly: Record<string, string> = {
    form_password_incorrect: "That password isn't right. Try again, or reset it below.",
    form_identifier_not_found: "We couldn't find an account with that email.",
    form_code_incorrect: "That code isn't right. Check the email and try again.",
    verification_expired: "That code has expired. Send a new one.",
    form_identifier_exists: "An account already uses that email. Sign in instead.",
    form_password_pwned:
      "That password has appeared in a data breach elsewhere. Please choose a different one.",
    too_many_requests: "Too many attempts. Wait a minute and try again.",
  };
  if (code && friendly[code]) return friendly[code];
  return first?.longMessage ?? first?.message ?? e?.longMessage ?? e?.message ?? "Something went wrong. Please try again.";
}

/** Only ever redirect within this site after signing in. */
export function safeRedirect(raw: string | null): string {
  if (!raw) return "/";
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}` : "/";
  } catch {
    return "/";
  }
}

/** Mirrors the Clerk instance's password policy (Dashboard → Passwords). */
export const PASSWORD_MIN = 15;
