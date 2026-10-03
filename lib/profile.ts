import type { UserType } from "@/db/schema";
import { GeocodeError, resolveLocation } from "@/lib/onemap";

export const USER_TYPES: UserType[] = ["homeowner", "project_manager", "contractor", "epc_team"];

export type Profile = {
  fullName: string;
  userType: UserType;
  contactNo: string | null;
  icLast4: string | null;
  address: string | null;
  postalCode: string | null;
};

export class ProfileError extends Error {}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/**
 * Reads and checks the fields every account form shares. Throws ProfileError
 * with a message fit to show the person who typed it.
 *
 * Address and postal code: either is enough, and the other is filled in from
 * OneMap. If OneMap cannot be reached the values are kept as typed — a user's
 * own address is contact detail, not a geofence, so it is not worth refusing
 * the whole form over.
 */
export async function readProfile(form: FormData, roleKey = "userType"): Promise<Profile> {
  const fullName = text(form, "fullName");
  if (fullName.length < 2) throw new ProfileError("Enter a full name.");

  const userType = text(form, roleKey) as UserType;
  if (!USER_TYPES.includes(userType)) throw new ProfileError("Choose a role.");

  const contactNo = text(form, "contactNo") || null;
  if (contactNo && !/^\+?[\d\s-]{8,20}$/.test(contactNo)) {
    throw new ProfileError("Enter the contact number as digits, e.g. +65 9123 4567.");
  }

  // Last four only: three digits and the checksum letter. The database
  // enforces the same pattern, so a full NRIC cannot be stored either way.
  let icLast4 = text(form, "icLast4").toUpperCase() || null;
  if (icLast4 && icLast4.length > 4) {
    throw new ProfileError("Enter only the last 4 characters of the NRIC, e.g. 567D.");
  }
  if (icLast4 && !/^[0-9]{3}[A-Z]$/.test(icLast4)) {
    throw new ProfileError("NRIC last 4 should be three digits and a letter, e.g. 567D.");
  }
  if (userType !== "homeowner") icLast4 = null;

  let address = text(form, "address") || null;
  let postalCode = text(form, "postalCode") || null;
  if (postalCode && !/^\d{6}$/.test(postalCode)) {
    throw new ProfileError("A Singapore postal code is 6 digits.");
  }

  if (address || postalCode) {
    try {
      const loc = await resolveLocation({ address, postalCode });
      address = loc.address;
      postalCode = loc.postalCode;
    } catch (err) {
      // An unknown postal code is the user's mistake and worth saying; a
      // OneMap outage is not, so carry on with what was typed.
      if (err instanceof GeocodeError && (err.reason === "not_found" || err.reason === "invalid_query")) {
        throw new ProfileError(`${err.message}${err.hint ? ` ${err.hint}` : ""}`);
      }
    }
  }

  return { fullName, userType, contactNo, icLast4, address, postalCode };
}

export function readEmail(form: FormData): string {
  const email = text(form, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ProfileError("Enter a valid email address.");
  return email;
}
