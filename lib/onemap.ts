/**
 * Geocoding against OneMap, Singapore's official map service (run by SLA).
 *
 * Used once per project, when its address is set — never during a check-in.
 * Two reasons: OneMap rate-limits hard (three rapid requests was enough to
 * return 429), and a crew standing on a roof should not depend on a
 * third-party API answering before they can start work.
 */

const SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search";

export type GeocodeResult = {
  lat: number;
  lng: number;
  /** The address OneMap matched, so a wrong match is visible rather than silent. */
  address: string;
  postalCode: string | null;
  building: string | null;
  /** How many candidates matched. More than one means the query was ambiguous. */
  candidates: number;
};

export class GeocodeError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_found"
      | "ambiguous"
      | "rate_limited"
      | "unreachable"
      | "invalid_query",
    readonly hint?: string
  ) {
    super(message);
    this.name = "GeocodeError";
  }
}

const SG_POSTAL = /^\d{6}$/;

type OneMapResult = {
  SEARCHVAL?: string;
  ADDRESS?: string;
  POSTAL?: string;
  BUILDING?: string;
  LATITUDE?: string;
  LONGITUDE?: string;
};

async function search(query: string, attempt = 0): Promise<OneMapResult[]> {
  const url =
    `${SEARCH_URL}?searchVal=${encodeURIComponent(query)}` +
    `&returnGeom=Y&getAddrDetails=Y&pageNum=1`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new GeocodeError(
      `Could not reach OneMap: ${err instanceof Error ? err.message : err}`,
      "unreachable"
    );
  }

  if (response.status === 429) {
    // Backoff rather than failing outright: a PM saving several projects in a
    // row trips this easily.
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return search(query, attempt + 1);
    }
    throw new GeocodeError(
      "OneMap is rate limiting us. Try again in a minute.",
      "rate_limited"
    );
  }

  if (!response.ok) {
    throw new GeocodeError(`OneMap returned ${response.status}.`, "unreachable");
  }

  const body = (await response.json()) as { found?: number; results?: OneMapResult[] };
  return body.results ?? [];
}

/**
 * Resolves a Singapore address to coordinates.
 *
 * Prefer a postal code. Singapore postal codes identify a single building,
 * whereas street text does not: searching "14 Jalan Kayu" returns five fuzzy
 * matches, none of them that address. Geocoding to the wrong house would put
 * the 100 m fence around a building the crew will never stand in.
 */
export async function geocode(query: string): Promise<GeocodeResult> {
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    throw new GeocodeError("Enter a postal code or address.", "invalid_query");
  }

  const results = await search(trimmed);

  if (results.length === 0) {
    throw new GeocodeError(
      `OneMap found nothing for "${trimmed}".`,
      "not_found",
      SG_POSTAL.test(trimmed)
        ? "Check the postal code is correct."
        : "Try the 6-digit postal code instead of the street address."
    );
  }

  const usable = results.filter((r) => r.LATITUDE && r.LONGITUDE);
  if (usable.length === 0) {
    throw new GeocodeError(`OneMap returned no coordinates for "${trimmed}".`, "not_found");
  }

  // Several entries at one postal code (a 239/239A pair, say) share a
  // building and therefore coordinates; that is not ambiguity.
  const first = usable[0];
  const spread = usable.some(
    (r) =>
      Math.abs(Number(r.LATITUDE) - Number(first.LATITUDE)) > 0.0005 ||
      Math.abs(Number(r.LONGITUDE) - Number(first.LONGITUDE)) > 0.0005
  );

  if (spread && !SG_POSTAL.test(trimmed)) {
    throw new GeocodeError(
      `"${trimmed}" matched ${usable.length} different places.`,
      "ambiguous",
      "Use the 6-digit postal code — it identifies one building."
    );
  }

  return {
    lat: Number(first.LATITUDE),
    lng: Number(first.LONGITUDE),
    address: first.ADDRESS ?? first.SEARCHVAL ?? trimmed,
    postalCode: first.POSTAL && first.POSTAL !== "NIL" ? first.POSTAL : null,
    building: first.BUILDING && first.BUILDING !== "NIL" ? first.BUILDING : null,
    candidates: usable.length,
  };
}
