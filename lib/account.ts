import { currentUser } from "@clerk/nextjs/server";

import type { AccountRequest, User, UserType } from "@/db/schema";
import { asActor, sql } from "@/lib/db";

/**
 * Where a signed-in person stands with GetHomeApps.
 *
 * Clerk proves who someone is; this decides whether they have an account.
 * Signing in to Clerk is not enough — an account exists only once a project
 * manager has created one or approved a request for one.
 */
export type AccountState =
  | { state: "active"; user: User }
  | { state: "deactivated"; user: User }
  | { state: "pending"; request: AccountRequest }
  | { state: "rejected"; request: AccountRequest; clerk: ClerkIdentity }
  | { state: "no_account"; clerk: ClerkIdentity }
  | { state: "signed_out" };

export type ClerkIdentity = {
  clerkUserId: string;
  /** Verified addresses only. An unverified one proves nothing. */
  emails: string[];
  primaryEmail: string | null;
  fullName: string | null;
  phone: string | null;
};

export const ROLE_LABEL: Record<UserType, string> = {
  homeowner: "Homeowner",
  project_manager: "Project Manager",
  contractor: "Contractor Admin",
  epc_team: "EPC Team",
};

/** Snake-case rows from the driver, into the camelCase shape of the schema. */
function camel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out as T;
}

export async function resolveAccount(): Promise<AccountState> {
  const clerkUser = await currentUser();
  if (!clerkUser) return { state: "signed_out" };

  const verified = clerkUser.emailAddresses
    .filter((e) => e.verification?.status === "verified")
    .map((e) => e.emailAddress.toLowerCase());

  const clerk: ClerkIdentity = {
    clerkUserId: clerkUser.id,
    emails: verified,
    primaryEmail: clerkUser.primaryEmailAddress?.emailAddress.toLowerCase() ?? verified[0] ?? null,
    fullName: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null,
    phone: clerkUser.primaryPhoneNumber?.phoneNumber ?? null,
  };

  const db = sql();

  // 1. Already linked.
  const linked = (await db`select * from users where clerk_user_id = ${clerk.clerkUserId}`) as Array<
    Record<string, unknown>
  >;
  if (linked.length) {
    const user = camel<User>(linked[0]);
    return user.active ? { state: "active", user } : { state: "deactivated", user };
  }

  // 2. A project manager created this account and is waiting for them to
  //    turn up. Match on a verified email only: anyone can type an address
  //    into a sign-up form, but Clerk only marks it verified once they have
  //    proved they receive mail there.
  if (verified.length) {
    const invited = (await db`
      select * from users
       where lower(email) = any(${verified}) and clerk_user_id is null
       order by uid limit 1`) as Array<Record<string, unknown>>;
    if (invited.length) {
      const uid = Number(invited[0].uid);
      // Acting as themselves: the database lets a user set their own
      // clerk_user_id exactly once, from empty.
      const rows = await asActor(uid, (tx) => [
        tx`update users set clerk_user_id = ${clerk.clerkUserId}, updated_at = now()
            where uid = ${uid} and clerk_user_id is null
           returning *`,
      ]);
      if (rows.length) {
        const user = camel<User>(rows[0]);
        return user.active ? { state: "active", user } : { state: "deactivated", user };
      }
    }
  }

  // 3. They asked for an account themselves.
  const requests = (await db`
    select * from account_requests
     where clerk_user_id = ${clerk.clerkUserId}
     order by created_at desc limit 1`) as Array<Record<string, unknown>>;
  if (requests.length) {
    const request = camel<AccountRequest>(requests[0]);
    if (request.status === "pending") return { state: "pending", request };
    if (request.status === "rejected") return { state: "rejected", request, clerk };
    // "approved" but no linked user means the account was later removed.
  }

  return { state: "no_account", clerk };
}

/** For pages and actions that need an active account, optionally of a given role. */
export async function requireAccount(...roles: UserType[]): Promise<User> {
  const account = await resolveAccount();
  if (account.state !== "active") {
    throw new AccountError("You don't have an active account.", 401);
  }
  if (roles.length && !roles.includes(account.user.userType)) {
    throw new AccountError("Your role can't do that.", 403);
  }
  return account.user;
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403
  ) {
    super(message);
    this.name = "AccountError";
  }
}
