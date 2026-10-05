"use client";

import { type ReactNode, useEffect } from "react";

import { I } from "./icons";

export type Tone = "ok" | "bad" | "warn" | "info" | "mut";

export function Pill({ tone = "mut", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`pill ${tone}`}>
      {tone !== "mut" && <i />}
      {children}
    </span>
  );
}

export function Sec({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="sec">
      <h2>{title}</h2>
      <div className="rule" />
      {right}
    </div>
  );
}

export function Ring({ pc, size = 104, stroke = 4 }: { pc: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--track)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--brand)"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pc / 100)}
          style={{ transition: "stroke-dashoffset .8s cubic-bezier(.3,.9,.3,1)" }}
        />
      </svg>
      <div className="val">
        <b>
          {pc}
          <span style={{ fontSize: ".5em", letterSpacing: 0 }}>%</span>
        </b>
        <small>Complete</small>
      </div>
    </div>
  );
}

/** Bottom sheet on phones, centred dialog on desktop. Escape or the backdrop closes it. */
export function Sheet({
  title,
  sub,
  onClose,
  children,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="veil" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sh">
          <div className="grow">
            <h3>{title}</h3>
            {sub && (
              <div className="tiny" style={{ marginTop: 3 }}>
                {sub}
              </div>
            )}
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            <I.x size={16} />
          </button>
        </div>
        <div className="sb">{children}</div>
      </div>
    </div>
  );
}

export function initials(name: string | null | undefined): string {
  return (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** "29 Jul 2026" — dates as people in Singapore write them. */
export function d2s(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00+08:00`) : new Date(d);
  return date.toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Singapore",
  });
}

/** "just now", "5 min ago", "2 h ago", "3 d ago", then a date. */
export function ago(d: string | Date | null | undefined): string {
  if (!d) return "";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return d2s(d);
}

/** "29 Jul 2026 14:05" in Singapore time, whatever the device's clock says. */
export function dt2s(d: string | Date | null | undefined): string {
  if (!d) return "";
  return new Date(d)
    .toLocaleString("en-SG", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Singapore",
    })
    .replace(",", "");
}
