"use client";



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
