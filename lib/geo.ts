/**
 * Distance and geofence rules shared by the browser and the server.
 *
 * The browser uses these to give immediate feedback before anyone taps
 * "check in"; the server re-checks them; and the database enforces them in a
 * trigger. The last one is the guarantee — a client controls the coordinates
 * it reports, so a check that only runs there is advisory at best.
 */

/** Metres a crew may be from the house. Overridable per project in the database. */
export const DEFAULT_CHECK_IN_RADIUS_M = 100;

/**
 * A fix less precise than this cannot be judged against a 100 m fence either
 * way, so it is refused. Must match geo_max_accuracy_m() in the database.
 */
export const MAX_ACCURACY_M = 50;

/**
 * Shown to the crew for every refusal, whether the fix is weak or they are
 * simply somewhere else. The remedy is the same — move — and a message that
 * reports the exact distance invites arguing with it. The real reason is kept
 * in the error detail for the project manager and the logs.
 */
export const GPS_REFUSED_MESSAGE =
  "You're currently not receiving GPS signal, please move to a spot where you can.";

/** Great-circle distance in metres. Mirrors geo_distance_m() in the database. */
export function distanceMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

export type FenceVerdict =
  | { allowed: true; distanceM: number }
  | {
      allowed: false;
      /** Safe to show the crew. */
      message: string;
      /** For the project manager, the audit trail and logs — not the crew. */
      detail: string;
      distanceM: number | null;
    };

export function checkFence(params: {
  siteLat: number | null;
  siteLng: number | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  radiusM?: number;
  phase: "check-in" | "check-out";
}): FenceVerdict {
  const radius = params.radiusM ?? DEFAULT_CHECK_IN_RADIUS_M;

  if (params.siteLat === null || params.siteLng === null) {
    return {
      allowed: false,
      message: "This site has no verified location yet. Ask your project manager.",
      detail: "project has no geocoded coordinates",
      distanceM: null,
    };
  }

  if (params.lat === null || params.lng === null) {
    return {
      allowed: false,
      message: GPS_REFUSED_MESSAGE,
      detail: `${params.phase} submitted with no coordinates`,
      distanceM: null,
    };
  }

  if (params.accuracyM === null || params.accuracyM > MAX_ACCURACY_M) {
    return {
      allowed: false,
      message: GPS_REFUSED_MESSAGE,
      detail: `${params.phase} fix accurate only to ${
        params.accuracyM === null ? "unknown" : params.accuracyM.toFixed(1)
      } m (limit ${MAX_ACCURACY_M} m)`,
      distanceM: null,
    };
  }

  const distanceM = distanceMetres(
    params.siteLat,
    params.siteLng,
    params.lat,
    params.lng
  );

  if (distanceM > radius) {
    return {
      allowed: false,
      message: GPS_REFUSED_MESSAGE,
      detail: `${params.phase} was ${distanceM.toFixed(1)} m from the site (limit ${radius} m)`,
      distanceM,
    };
  }

  return { allowed: true, distanceM };
}
