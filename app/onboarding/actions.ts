"use server";

import { revalidatePath } from "next/cache";

import { ROLE_LABEL, resolveAccount } from "@/lib/account";
import { asActor, sql } from "@/lib/db";
import { notify } from "@/lib/notify";
import { accountRequested, appUrl } from "@/lib/notify/messages";
import { ProfileError, readProfile } from "@/lib/profile";

export type RequestState = { ok: boolean; message: string } | null;

/**
 * Someone who signed up through Clerk asks for an account.
 *
 * Nothing is granted here. The row lands as "pending" — the database forces
 * that whatever is sent — and every active project manager is told.
 */
export async function requestAccount(_prev: RequestState, form: FormData): Promise<RequestState> {
  try {
    const account = await resolveAccount();
    if (account.state !== "no_account" && account.state !== "rejected") {
      return { ok: false, message: "You already have an account or a request in progress." };
    }
    const { clerk } = account;
    if (!clerk.primaryEmail || !clerk.emails.includes(clerk.primaryEmail)) {
      return { ok: false, message: "Verify your email address with the sign-in provider first." };
    }

    const profile = await readProfile(form, "requestedType");
    const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;

    // No actor: the requester has no account yet, and the database does not
    // need one to accept a pending request.
    await asActor(null, (tx) => [
      tx`insert into account_requests (clerk_user_id, email, full_name, requested_type,
                                       contact_no, ic_last4, address, postal_code, note)
         values (${clerk.clerkUserId}, ${clerk.primaryEmail}, ${profile.fullName},
                 ${profile.userType}, ${profile.contactNo}, ${profile.icLast4},
                 ${profile.address}, ${profile.postalCode}, ${note})`,
    ]);

    // Tell the project managers. In-app plus email; WhatsApp to staff for
    // every sign-up would be noise.
    const pms = (await sql()`
      select uid, email from users where user_type = 'project_manager' and active`) as Array<{
      uid: number;
      email: string;
    }>;
    const m = accountRequested({
      requester: profile.fullName,
      email: clerk.primaryEmail,
      role: ROLE_LABEL[profile.userType],
      url: `${appUrl()}/admin/users`,
    });
    await Promise.allSettled(
      pms.map((pm) =>
        notify({
          recipientUid: pm.uid,
          kind: "account_request",
          title: m.inApp.title,
          body: m.inApp.body,
          email: { to: pm.email, ...m.email },
        })
      )
    );

    revalidatePath("/onboarding");
    return { ok: true, message: "Request sent." };
  } catch (err) {
    if (err instanceof ProfileError) return { ok: false, message: err.message };
    const msg = err instanceof Error ? err.message : String(err);
    if (/account_requests_one_pending_idx/.test(msg)) {
      return { ok: false, message: "You already have a request waiting for approval." };
    }
    console.error("[onboarding]", err);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
