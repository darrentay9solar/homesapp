"use client";

import AccountCircleOutlinedIcon from "@mui/icons-material/AccountCircleOutlined";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import VisibilityOffRoundedIcon from "@mui/icons-material/VisibilityOffRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button, { type ButtonProps } from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MuiLink from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import type { SxProps, Theme } from "@mui/material/styles";
import TextField, { type TextFieldProps } from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { type ClipboardEvent, createContext, type KeyboardEvent, type ReactNode, useContext, useEffect, useRef, useState } from "react";

import { DESIGN } from "@/lib/client/design";
import { T, TR } from "@/lib/client/i18n";

import { Logo } from "./icons";
import { COUNTRIES, joinPhone, splitPhone } from "./phone-input";
import { SkyScene } from "./sky-scene";
import { ThemeButton } from "./theme-button";

/**
 * The account screens (Sign In, Create Account, Forgot Password, Request
 * Access), built from Material UI and the template's numbers (design.ts):
 *
 *  - Phones: a wavy green header with back, title and theme button; the form below.
 *  - Tablets: the same, as a centred card.
 *  - Desktop: the animated sky on the left; the form directly on the green
 *    panel on the right, with white fields and a white main button.
 *
 * data-auth markers let the design check find each part.
 */

const DESK = `@media (min-width: ${DESIGN.layout.desktopFrom}px)`;
const TABLET = "@media (min-width: 560px)";
const PANEL_TEXT = "rgba(255,255,255,0.8)";

/** Long forms (Create Account, Request Access) use a narrower, centred column on desktop. */
const Compact = createContext(false);

export function AuthShell({
  title,
  back,
  compact = false,
  children,
}: {
  title: string;
  back?: string | (() => void);
  compact?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const goBack = back ? () => (typeof back === "string" ? router.push(back) : back()) : null;
  return (
    <Compact.Provider value={compact}>
      <Box
        component="main"
        data-auth="shell"
        sx={{
          minHeight: "100dvh",
          display: "flex",
          justifyContent: "center",
          bgcolor: "background.default",
          [TABLET]: { alignItems: "center", px: 2, py: 4 },
          [DESK]: { display: "grid", gridTemplateColumns: "1fr minmax(520px, 46%)", alignItems: "start", p: 0, bgcolor: DESIGN.green.header },
        }}
      >
        <Box
          data-auth="main"
          sx={{
            width: "100%",
            display: "flex",
            justifyContent: "center",
            [DESK]: { gridColumn: 2, gridRow: 1, position: "relative", overflow: "hidden", bgcolor: DESIGN.green.header, minHeight: "100dvh", alignItems: "center", px: 7, py: 5 },
          }}
        >
          {/* Desktop: the panel's soft waves behind the form. */}
          <Box component="svg" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" sx={{ display: "none", [DESK]: { display: "block", position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" } }}>
            <circle cx="560" cy="90" r="210" fill="rgba(255,255,255,.06)" />
            <path d="M0 640C120 590 220 670 340 630S520 550 600 590V900H0Z" fill="rgba(255,255,255,.07)" />
            <path d="M0 730C140 690 250 760 380 720S540 670 600 700V900H0Z" fill="rgba(255,255,255,.07)" />
          </Box>
          <Box
            data-auth="card"
            sx={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              bgcolor: "background.default",
              [TABLET]: { maxWidth: 440, borderRadius: "26px", overflow: "hidden", border: 1, borderColor: "divider", boxShadow: "0 24px 60px -32px rgba(0,0,0,0.45)" },
              [DESK]: { position: "relative", maxWidth: compact ? 420 : "clamp(440px, 34vw, 600px)", border: 0, borderRadius: 0, boxShadow: "none", overflow: "visible", bgcolor: "transparent", color: "#fff" },
            }}
          >
            {/* Desktop bar: back, the brand, and the theme button. */}
            <Stack direction="row" sx={{ display: "none", [DESK]: { display: "flex", alignItems: "center", gap: 1.5, mb: "clamp(28px, 3vw, 44px)" } }}>
              {goBack && (
                <IconButton aria-label={T("Back")} onClick={goBack} sx={{ color: "#fff", border: "1px solid rgba(255,255,255,0.4)", mr: -0.5 }}>
                  <ArrowBackRoundedIcon />
                </IconButton>
              )}
              <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, mr: "auto" }}>
                <Box sx={{ width: 56, height: 56, display: "grid", placeItems: "center", borderRadius: "16px", bgcolor: "rgba(255,255,255,0.14)" }}>
                  <Logo size={36} color="#fff" />
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 600, fontSize: 13.5, letterSpacing: "0.22em", color: "#fff" }}>GETHOMEAPPS</Typography>
                  <Typography sx={{ fontWeight: 500, fontSize: 8.5, letterSpacing: "0.26em", color: "rgba(255,255,255,0.72)", mt: 0.25 }}>9 SOLAR HOME · 九太阳家</Typography>
                </Box>
              </Stack>
              <ThemeButton onGreen />
            </Stack>

            {/* Phone and tablet: the wavy green header, lower on the left, rising right. */}
            <Box data-auth="band" sx={{ position: "relative", flex: "0 0 auto", height: "calc(128px + env(safe-area-inset-top))", color: "#fff", [DESK]: { display: "none" } }}>
              <Box component="svg" viewBox="0 0 440 176" preserveAspectRatio="none" aria-hidden="true" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}>
                <defs>
                  <linearGradient id="authBandFill" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor={DESIGN.green.header} />
                    <stop offset="1" stopColor={DESIGN.green.mid} />
                  </linearGradient>
                </defs>
                <path d="M0 0H440V96C380 132 320 118 244 122C156 127 76 140 0 172Z" fill="url(#authBandFill)" />
              </Box>
              <Stack direction="row" sx={{ position: "relative", alignItems: "center", gap: 1.25, px: 1.5, pt: "calc(12px + env(safe-area-inset-top))" }}>
                {goBack ? (
                  <IconButton aria-label={T("Back")} onClick={goBack} sx={{ color: "#fff" }}>
                    <ArrowBackRoundedIcon />
                  </IconButton>
                ) : (
                  <Box sx={{ width: 40 }} />
                )}
                <Typography component="h1" sx={{ flex: 1, textAlign: "center", fontSize: DESIGN.type.dialogTitle, fontWeight: 600, letterSpacing: "0.01em" }}>
                  {TR(title)}
                </Typography>
                <ThemeButton onGreen />
              </Stack>
            </Box>

            <Box data-auth="content" sx={{ flex: 1, display: "flex", flexDirection: "column", px: 3, pb: "calc(28px + env(safe-area-inset-bottom))", [DESK]: { p: 0 } }}>
              {children}
            </Box>
          </Box>
        </Box>
        {/* Desktop: the animated sky. */}
        <Box component="aside" data-auth="side" aria-hidden="true" sx={{ display: "none", [DESK]: { display: "block", gridColumn: 1, gridRow: 1, position: "sticky", top: 0, height: "100dvh", overflow: "hidden", bgcolor: "#0c0f1e" } }}>
          <SkyScene />
        </Box>
      </Box>
    </Compact.Provider>
  );
}

/** The logo above a phone's heading (desktop shows it in the top bar instead). */
export function Mark() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", mt: -2.25, mb: 0.75, [DESK]: { display: "none" } }}>
      <Logo size={46} />
    </Box>
  );
}

/** The round icon above a heading on result screens (code sent, waiting, done). */
export function AuthBadge({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        width: 76,
        height: 76,
        mx: "auto",
        mt: 1.25,
        mb: 2,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        color: "primary.main",
        bgcolor: "action.selected",
        "& svg": { fontSize: 34 },
        [DESK]: { mx: 0, mt: 0, mb: 2.75, color: "#fff", bgcolor: "rgba(255,255,255,0.16)" },
      }}
    >
      {children}
    </Box>
  );
}

export function AuthHeading({ children }: { children: ReactNode }) {
  const compact = useContext(Compact);
  return (
    <Typography
      component="h2"
      sx={{
        textAlign: "center",
        color: "primary.main",
        fontSize: DESIGN.type.dialogHeading.phone,
        fontWeight: 600,
        [DESK]: compact
          ? { color: "#fff", fontSize: "clamp(30px, 2.3vw, 40px)", lineHeight: 1.15, letterSpacing: "-0.02em" }
          : { color: "#fff", textAlign: "left", fontSize: "clamp(32px, 2.9vw, 50px)", lineHeight: 1.15, letterSpacing: "-0.02em" },
      }}
    >
      {children}
    </Typography>
  );
}

export function AuthSubtitle({ children }: { children: ReactNode }) {
  const compact = useContext(Compact);
  return (
    <Typography
      sx={{
        textAlign: "center",
        fontSize: 13,
        color: "text.secondary",
        lineHeight: 1.6,
        mt: 0.75,
        mb: 2.5,
        mx: "auto",
        maxWidth: "34ch",
        "& b": { color: "text.primary", fontWeight: 500 },
        [DESK]: compact
          ? { color: PANEL_TEXT, fontSize: 14, mt: 1.25, mb: 3.75, "& b": { color: "#fff" } }
          : { color: PANEL_TEXT, textAlign: "left", maxWidth: "none", mx: 0, mt: 1.5, mb: "clamp(32px, 3vw, 48px)", fontSize: "clamp(14.5px, 1.05vw, 17px)", "& b": { color: "#fff" } },
      }}
    >
      {children}
    </Typography>
  );
}

/** On the green desktop panel: translucent white fields, white label and text. */
const fieldSx: SxProps<Theme> = {
  mb: 2.25,
  [DESK]: {
    "& .MuiOutlinedInput-root": { bgcolor: "rgba(255,255,255,0.08)", color: "#fff" },
    "& .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(255,255,255,0.38)" },
    "& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(255,255,255,0.7)" },
    "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "#fff" },
    "& .MuiOutlinedInput-root.Mui-error .MuiOutlinedInput-notchedOutline": { borderColor: "#ffd2d2" },
    "& .MuiInputLabel-root, & .MuiInputLabel-root.Mui-focused": { color: "#fff" },
    "& .MuiInputAdornment-root, & .MuiInputAdornment-root .MuiIconButton-root, & .MuiSelect-icon": { color: "rgba(255,255,255,0.75)" },
    "& input::placeholder": { color: "rgba(255,255,255,0.55)", opacity: 1 },
    "& input:-webkit-autofill": { WebkitTextFillColor: "#fff", transition: "background-color 9999s" },
    "& .MuiFormHelperText-root": { color: "#ffe1e1" },
    "& .MuiSelect-select": { color: "#fff" },
  },
};

/** A text field in the template: icon at the start, label on the border. */
export function AuthField({ icon, error, ...props }: Omit<TextFieldProps, "error"> & { icon?: ReactNode; error?: string | null }) {
  return (
    <TextField
      {...props}
      label={typeof props.label === "string" ? TR(props.label) : props.label}
      placeholder={typeof props.placeholder === "string" ? TR(props.placeholder) : props.placeholder}
      error={Boolean(error)}
      helperText={error ?? undefined}
      fullWidth
      sx={[fieldSx, ...(Array.isArray(props.sx) ? props.sx : [props.sx])]}
      slotProps={{
        ...props.slotProps,
        inputLabel: { shrink: true },
        input: {
          ...(icon ? { startAdornment: <InputAdornment position="start" sx={{ "& svg": { fontSize: 19 } }}>{icon}</InputAdornment> } : {}),
          ...(props.slotProps?.input as object),
        },
      }}
    />
  );
}

export function PasswordField(props: Omit<TextFieldProps, "error" | "type"> & { error?: string | null }) {
  const [shown, setShown] = useState(false);
  return (
    <AuthField
      {...props}
      type={shown ? "text" : "password"}
      icon={<LockOutlinedIcon />}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton edge="end" aria-label={shown ? T("Hide password") : T("Show password")} onClick={() => setShown((s) => !s)}>
                {shown ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

/** Mobile with the country code inside the field ("SG +65 ▾ | 9123 4567"). */
export function AuthPhoneField({ id, value, onChange, error }: { id: string; value: string; onChange: (v: string) => void; error?: string | null }) {
  const [dial, setDial] = useState(() => splitPhone(value).dial);
  const { local } = splitPhone(value);
  return (
    <AuthField
      id={id}
      label="Mobile"
      type="tel"
      value={local}
      error={error}
      placeholder={dial === "65" ? "9123 4567" : "Mobile number"}
      onChange={(e) => onChange(joinPhone(dial, e.target.value.replace(/^\+/, "")))}
      slotProps={{
        htmlInput: { inputMode: "tel", autoComplete: "tel-national" },
        input: {
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 1.25, pr: 1.25, height: "auto", alignSelf: "stretch", maxHeight: "none", borderRight: 1, borderColor: "divider", [DESK]: { borderColor: "rgba(255,255,255,0.35)" } }}>
              <Select
                variant="standard"
                disableUnderline
                value={dial}
                onChange={(e) => {
                  setDial(e.target.value);
                  onChange(joinPhone(e.target.value, local));
                }}
                renderValue={(v) => `${COUNTRIES.find((c) => c.dial === v)?.code ?? ""} +${v}`}
                inputProps={{ "aria-label": T("Country code") }}
                sx={{ fontWeight: 500, fontSize: 15, "& .MuiSelect-select": { py: 0, pr: "22px !important" } }}
              >
                {COUNTRIES.map((c) => (
                  <MenuItem key={c.code} value={c.dial}>
                    {c.name} (+{c.dial})
                  </MenuItem>
                ))}
              </Select>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

/** The one main button: green on phones, white with green text on the desktop panel. */
export function AuthButton(props: ButtonProps) {
  return (
    <Button
      fullWidth
      size="large"
      variant="contained"
      type={props.onClick ? "button" : "submit"}
      {...props}
      sx={[
        {
          [DESK]: {
            bgcolor: "#fff",
            color: "#07603e",
            boxShadow: "0 14px 30px -16px rgba(0,0,0,0.45)",
            "&:hover": { bgcolor: "#eafff4" },
            // Repeated to outrank the theme's disabled green (.MuiButton-contained.MuiButton-colorPrimary.Mui-disabled).
            "&&&&.Mui-disabled": { bgcolor: "#fff", color: "#07603e", opacity: 0.5 },
          },
        },
        ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
      ]}
    />
  );
}

/** A problem with the form, in words. */
export function AuthError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <Alert severity="error" sx={{ mb: 1.75, [DESK]: { color: "#fff", bgcolor: "rgba(140,20,24,0.35)", border: "1px solid rgba(255,255,255,0.3)", "& .MuiAlert-icon": { color: "#fff" } } }}>
      {children}
    </Alert>
  );
}

/** "New here? Create an account" — the link line under the button. */
export function AuthAlt({ children }: { children: ReactNode }) {
  const compact = useContext(Compact);
  return (
    <Typography
      sx={{
        textAlign: "center",
        fontSize: 12.5,
        color: "text.secondary",
        mt: 2,
        "& a, & button": { color: "primary.main", fontWeight: 600, background: "none", border: 0, p: 0, cursor: "pointer", font: "inherit", textDecoration: "none" },
        [DESK]: {
          textAlign: compact ? "center" : "left",
          fontSize: "clamp(13.5px, 0.95vw, 15.5px)",
          mt: 3.25,
          color: "rgba(255,255,255,0.78)",
          "& a, & button": { color: "#fff", textDecoration: "underline", textUnderlineOffset: "3px" },
        },
      }}
    >
      {children}
    </Typography>
  );
}

/** A small text link (e.g. "Forgot password?"). */
export function AuthLink({ href, onClick, children }: { href: string; onClick?: () => void; children: ReactNode }) {
  return (
    <MuiLink component={NextLink} href={href} onClick={onClick} underline="none" sx={{ fontWeight: 600, fontSize: 12.5, color: "primary.main", [DESK]: { color: "#fff", textDecoration: "underline", textUnderlineOffset: "3px", fontSize: 13.5 } }}>
      {children}
    </MuiLink>
  );
}

/** Password rules as you type: "✓ 15+ characters". */
export function AuthRules({ rules, center }: { rules: Array<{ ok?: boolean; text: string }>; center?: boolean }) {
  const compact = useContext(Compact);
  return (
    <Stack
      direction="row"
      aria-live="polite"
      sx={{
        flexWrap: "wrap",
        columnGap: 1.75,
        rowGap: 0.5,
        mt: -1,
        mb: 2.25,
        mx: 0.25,
        fontSize: 11.5,
        color: "text.secondary",
        justifyContent: center ? "center" : "flex-start",
        [DESK]: { color: "rgba(255,255,255,0.75)", fontSize: compact ? 12 : 13.5, justifyContent: compact || center ? "center" : "flex-start" },
      }}
    >
      {rules.map((r) => (
        <Box key={r.text} component="span" sx={r.ok ? { color: "primary.main", [DESK]: { color: "#fff" } } : undefined}>
          {r.ok === undefined ? "" : r.ok ? "✓ " : "• "}
          {r.text}
        </Box>
      ))}
    </Stack>
  );
}

/** Six boxes; typing advances, backspace goes back, pasting a code fills all six. */
export function OtpInput({ value, onChange, onComplete, length = 6 }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; length?: number }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const compact = useContext(Compact);
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
    <Stack direction="row" role="group" aria-label={T("Verification code")} sx={{ justifyContent: "center", gap: 1, mt: 0.5, mb: 1.25, "@media (max-width: 360px)": { gap: 0.625 }, [DESK]: { justifyContent: compact ? "center" : "flex-start", gap: 1.25 } }}>
      {digits.map((d, i) => (
        <Box
          component="input"
          key={i}
          ref={(el: HTMLInputElement | null) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={length}
          aria-label={T("Digit {n}", { n: i + 1 })}
          value={d}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => onKey(i, e)}
          onPaste={onPaste}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const typed = e.target.value.replace(/\D/g, "");
            if (!typed) return set(value.slice(0, i));
            // A phone's one-time-code autofill can drop all six into one box.
            if (typed.length > 1) return set(value.slice(0, i) + typed);
            set(value.slice(0, i) + typed + value.slice(i + 1));
          }}
          sx={{
            width: 46,
            height: 54,
            borderRadius: `${DESIGN.radius.field}px`,
            border: "1px solid transparent",
            bgcolor: "action.hover",
            textAlign: "center",
            fontSize: 22,
            fontWeight: 600,
            fontFamily: "inherit",
            color: "text.primary",
            outline: "none",
            caretColor: (t: Theme) => t.palette.primary.main,
            "&:focus": { borderColor: "primary.main", boxShadow: (t: Theme) => `0 0 0 3px ${t.palette.primary.main}29` },
            "@media (max-width: 360px)": { width: 40, height: 50 },
            [DESK]: { width: compact ? 50 : 56, height: compact ? 56 : 62, fontSize: compact ? 22 : 24, bgcolor: "rgba(255,255,255,0.12)", color: "#fff", caretColor: "#fff", "&:focus": { borderColor: "#fff", boxShadow: "0 0 0 3px rgba(255,255,255,0.2)" } },
          }}
        />
      ))}
    </Stack>
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
    <AuthAlt>
      {T("Didn't receive it?")}{" "}
      {left > 0 ? (
        <span>{T("Resend in 0:{s}", { s: String(left).padStart(2, "0") })}</span>
      ) : (
        <button
          type="button"
          onClick={async () => {
            setLeft(45);
            await onResend();
          }}
        >
          {T("Resend")}
        </button>
      )}
    </AuthAlt>
  );
}

/** A grid of choices (Request Access's role picker): two per row, the chosen one outlined. */
export function AuthChoices<V extends string>({ value, onChange, options, label }: { value: V | null; onChange: (v: V) => void; options: Array<{ value: V; label: string; desc: string; icon: ReactNode }>; label: string }) {
  return (
    <Box role="radiogroup" aria-label={TR(label)} sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, mb: 2.75 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Box
            component="button"
            type="button"
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            sx={(t) => ({
              textAlign: "left",
              p: 1.625,
              borderRadius: `${DESIGN.radius.button}px`,
              border: 1,
              borderColor: on ? "primary.main" : "divider",
              bgcolor: on ? "action.selected" : "transparent",
              boxShadow: on ? `0 0 0 1px ${t.palette.primary.main} inset` : "none",
              color: "text.primary",
              font: "inherit",
              cursor: "pointer",
              transition: "border-color .18s, background-color .18s",
              "&:hover": { borderColor: on ? "primary.main" : "text.secondary" },
              [DESK]: on
                ? { bgcolor: "#fff", borderColor: "#fff", boxShadow: "none", color: "#07603e" }
                : { color: "#fff", borderColor: "rgba(255,255,255,0.35)", bgcolor: "rgba(255,255,255,0.06)", "&:hover": { borderColor: "rgba(255,255,255,0.7)" } },
            })}
          >
            <Stack direction="row" sx={{ alignItems: "center", gap: 0.875, fontSize: 13, fontWeight: 600, color: on ? "primary.main" : "inherit", "& svg": { fontSize: 16 }, [DESK]: { color: on ? "#07603e" : "#fff" } }}>
              {o.icon}
              {TR(o.label)}
            </Stack>
            <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 0.5, lineHeight: 1.4, [DESK]: { color: on ? "#3f6b58" : "rgba(255,255,255,0.72)" } }}>{TR(o.desc)}</Typography>
          </Box>
        );
      })}
    </Box>
  );
}

/** Vertical progress steps (where an account request stands). */
export function AuthSteps({ steps }: { steps: Array<{ state: "done" | "now" | "next"; label: string; detail: string }> }) {
  return (
    <Box sx={{ mx: "auto", mb: 3, maxWidth: 320, width: "100%" }}>
      {steps.map((s, i) => (
        <Stack key={s.label} direction="row" sx={{ gap: 1.5, position: "relative", pb: i < steps.length - 1 ? 2.25 : 0 }}>
          {i < steps.length - 1 && <Box sx={{ position: "absolute", left: 11, top: 24, bottom: 0, width: "1px", bgcolor: "divider", [DESK]: { bgcolor: "rgba(255,255,255,0.3)" } }} />}
          <Box
            sx={{
              width: 23,
              height: 23,
              borderRadius: "50%",
              flex: "0 0 auto",
              display: "grid",
              placeItems: "center",
              fontSize: 10.5,
              fontWeight: 600,
              border: 1,
              ...(s.state === "done"
                ? { bgcolor: "primary.main", borderColor: "primary.main", color: "primary.contrastText", [DESK]: { bgcolor: "#fff", borderColor: "#fff", color: "#07603e" } }
                : s.state === "now"
                  ? { borderColor: "warning.main", color: "warning.main", [DESK]: { borderColor: "#ffd27a", color: "#ffd27a" } }
                  : { borderColor: "divider", color: "text.secondary", [DESK]: { borderColor: "rgba(255,255,255,0.45)", color: "#fff" } }),
            }}
          >
            {s.state === "done" ? <CheckRoundedIcon sx={{ fontSize: 13 }} /> : i + 1}
          </Box>
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 500, mt: 0.25 }}>{TR(s.label)}</Typography>
            <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.25, [DESK]: { color: "rgba(255,255,255,0.72)" } }}>{TR(s.detail)}</Typography>
          </Box>
        </Stack>
      ))}
    </Box>
  );
}

/** Clerk errors, as one sentence a person can act on (in their language). */
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
    form_password_pwned: "That password has appeared in a data breach elsewhere. Please choose a different one.",
    too_many_requests: "Too many attempts. Wait a minute and try again.",
  };
  if (code && friendly[code]) return T(friendly[code]);
  return TR(first?.longMessage ?? first?.message ?? e?.longMessage ?? e?.message ?? "Something went wrong. Please try again.");
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

/** The person icon, for the name field. */
export const PersonIcon = AccountCircleOutlinedIcon;
