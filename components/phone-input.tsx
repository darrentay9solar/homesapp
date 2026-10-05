"use client";

import { useState } from "react";

/**
 * A mobile number with its country code, stored as one string:
 * "+65 9123 4567". Singapore first and the default; then the countries 9
 * Solar Home's customers and crews most often come from.
 */
export const COUNTRIES: Array<{ code: string; dial: string; name: string }> = [
  { code: "SG", dial: "65", name: "Singapore" },
  { code: "MY", dial: "60", name: "Malaysia" },
  { code: "ID", dial: "62", name: "Indonesia" },
  { code: "TH", dial: "66", name: "Thailand" },
  { code: "PH", dial: "63", name: "Philippines" },
  { code: "VN", dial: "84", name: "Vietnam" },
  { code: "MM", dial: "95", name: "Myanmar" },
  { code: "CN", dial: "86", name: "China" },
  { code: "HK", dial: "852", name: "Hong Kong" },
  { code: "TW", dial: "886", name: "Taiwan" },
  { code: "IN", dial: "91", name: "India" },
  { code: "BD", dial: "880", name: "Bangladesh" },
  { code: "AU", dial: "61", name: "Australia" },
  { code: "GB", dial: "44", name: "United Kingdom" },
  { code: "US", dial: "1", name: "United States / Canada" },
];

/** Splits "+65 9123 4567" into its country and the rest. Unknown prefixes fall back to Singapore. */
export function splitPhone(value: string | null | undefined): { dial: string; local: string } {
  const v = (value ?? "").trim();
  if (v.startsWith("+")) {
    const digits = v.slice(1).replace(/\s+/, " ");
    // Longest dial code first, so +852 is not read as +85…
    const match = [...COUNTRIES]
      .sort((a, b) => b.dial.length - a.dial.length)
      .find((c) => digits.replace(/\D/g, "").startsWith(c.dial));
    if (match) {
      const rest = v.replace(/^\+\s*/, "").replace(new RegExp(`^${match.dial}\\s*`), "");
      return { dial: match.dial, local: rest.trim() };
    }
  }
  return { dial: "65", local: v };
}

export function joinPhone(dial: string, local: string): string {
  const l = local.trim();
  return l ? `+${dial} ${l}` : "";
}

export function PhoneInput({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  // The dial code is kept locally too, so choosing a country before typing
  // the number isn't lost while the number is still empty.
  const [dial, setDial] = useState(() => splitPhone(value).dial);
  const { local } = splitPhone(value);

  return (
    <div className="phone">
      {/* A native select (best picker on phones) laid invisibly over a
          compact "SG +65" label, so the closed state stays narrow. */}
      <span className="cc">
        <span className="mono">
          {COUNTRIES.find((c) => c.dial === dial)?.code ?? ""} +{dial}
        </span>
        <select
        aria-label="Country code"
        value={dial}
        disabled={disabled}
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
        className="inp mono"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder={dial === "65" ? "9123 4567" : "Mobile number"}
        value={local}
        disabled={disabled}
        onChange={(e) => onChange(joinPhone(dial, e.target.value.replace(/^\+/, "")))}
      />
    </div>
  );
}
