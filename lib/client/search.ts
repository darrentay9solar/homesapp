/**
 * One set of search rules for the whole app: lists (projects, people, the
 * audit log, My Files) and the pickers inside forms.
 *
 *  - Every word must match somewhere ("apex epc", "jalan panels").
 *  - Case, accents and full-width characters don't matter ("Résumé" = "resume").
 *  - A number matches phone numbers whatever their spacing ("91234567" finds
 *    "+65 9123 4567").
 *  - Quotes and stray punctuation around words are ignored.
 */

import { normalise, tokens } from "./people-search";

export { normalise, tokens };

const digitsOf = (s: string) => s.replace(/\D/g, "");

export function matchesAll(parts: Array<string | null | undefined>, query: string): boolean {
  const words = tokens(query);
  if (!words.length) return true;
  const text = parts.filter(Boolean) as string[];
  const hay = normalise(text.join(" | "));
  const digits = text.map(digitsOf).filter(Boolean);
  return words.every((w) => {
    if (/^\+?[\d-]+$/.test(w)) {
      const d = digitsOf(w);
      if (d.length >= 2 && digits.some((x) => x.includes(d))) return true;
    }
    return hay.includes(w);
  });
}

/** A filterOptions for MUI Autocomplete that searches the given fields with the app's rules. */
export function pickerFilter<T>(fields: (option: T) => Array<string | null | undefined>) {
  return (options: T[], state: { inputValue: string }): T[] => options.filter((o) => matchesAll(fields(o), state.inputValue));
}
