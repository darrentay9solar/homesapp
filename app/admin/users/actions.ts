"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

import type { UserType } from "@/db/schema";
import { AccountError, ROLE_LABEL, requireAccount } from "@/lib/account";
import { asActor, sql } from "@/lib/db";
import { describeReport, notify, toWhatsAppNumber } from "@/lib/notify";
import { sendEmail, sendWhatsApp } from "@/lib/notify/channels";
import { accountApproved, accountCreated, accountRejected, appUrl } from "@/lib/notify/messages";
import { ProfileError, USER_TYPES, readEmail, readProfile } from "@/lib/profile";

export type ActionState = { ok: boolean; message: string } | null;

/** Turns the errors a PM can do something about into a message; rethrows the rest. */
function failure(err: unknown): ActionState {
  if (err instanceof ProfileError || err instanceof AccountError) {
    return { ok: false, message: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/users_email_lower_idx|duplicate key.*email/i.test(msg)) {
    return { ok: false, message: "An account with that email already exists." };
  }
  // Messages raised by the database's own guards are written for people.
  if (/project manager|cannot be changed|already been|must remain/i.test(msg)) {
    return { ok: false, message: msg.split("\n")[0] };
  }
  console.error("[admin/users]", err);
  return { ok: false, message: "Something went wrong. Nothing was sent; please try again." };
}

// ------------------------------------------------------------ create user

/**
 * A project manager creates an account. The person gets an email and a
 * WhatsApp message saying which role they were given, with a link to set up
 * their login.
 *
 * The link is a Clerk invitation, created with notify:false so Clerk does not
 * send its own generic email as well — ours names the role and carries the
 * 9 Solar Home branding. If the address already has a Clerk login (they
 * signed up before), there is nothing to invite; the message points them at
 * the sign-in page and the account links itself the next time they sign in.
 */
export async function createUser(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const pm = await requireAccount("project_manager");
    const email = readEmail(form);
    const profile = await readProfile(form);

    const [created] = await asActor<{ uid: number }>(pm.uid, (tx) => [
      tx`insert into users (full_name, user_type, contact_no, ic_last4, email, address,
                            postal_code, invited_at, invited_by)
         values (${profile.fullName}, ${profile.userType}, ${profile.contactNo}, ${profile.icLast4},
                 ${email}, ${profile.address}, ${profile.postalCode}, now(), ${pm.uid})
         returning uid`,
    ]);

    let link = `${appUrl()}/sign-in`;
    try {
      const invitation = await (await clerkClient()).invitations.createInvitation({
        emailAddress: email,
        redirectUrl: `${appUrl()}/sign-up`,
        notify: false,
        ignoreExisting: true,
        expiresInDays: 30,
      });
      if (invitation.url) link = invitation.url;
      await asActor(pm.uid, (tx) => [
        tx`update users set clerk_invitation_id = ${invitation.id} where uid = ${created.uid}`,
      ]);
    } catch (err) {
      // Most often: the address already has a Clerk login. Sign-in still works.
      console.warn("[admin/users] invitation not created:", err instanceof Error ? err.message : err);
    }

    const role = ROLE_LABEL[profile.userType];
    const m = accountCreated({ name: profile.fullName, role, url: link });
    const report = await notify({
      recipientUid: created.uid,
      kind: "account_created",
      title: m.inApp.title,
      body: m.inApp.body,
      email: { to: email, ...m.email },
      whatsapp: { to: toWhatsAppNumber(profile.contactNo), ...m.whatsapp },
    });

    revalidatePath("/admin/users");
    return { ok: true, message: `Created ${profile.fullName} as ${role}. ${describeReport(report)}` };
  } catch (err) {
    return failure(err);
  }
}

// ------------------------------------------------------ approve / reject

export async function approveRequest(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const pm = await requireAccount("project_manager");
    const requestId = Number(form.get("requestId"));
    const userType = String(form.get("userType") ?? "") as UserType;
    if (!USER_TYPES.includes(userType)) throw new ProfileError("Choose a role to grant.");
    const note = String(form.get("note") ?? "").trim() || null;

    // One statement: the account and the approval exist together or not at all.
    const [{ uid }] = await asActor<{ uid: number }>(pm.uid, (tx) => [
      tx`select approve_account_request(${requestId}, ${userType}, ${note}) as uid`,
    ]);

    const [user] = (await sql()`
      select full_name, email, contact_no from users where uid = ${uid}`) as Array<{
      full_name: string;
      email: string;
      contact_no: string | null;
    }>;

    const role = ROLE_LABEL[userType];
    const m = accountApproved({ name: user.full_name, role, url: appUrl() });
    const report = await notify({
      recipientUid: uid,
      kind: "account_approved",
      title: m.inApp.title,
      body: m.inApp.body,
      email: { to: user.email, ...m.email },
      whatsapp: { to: toWhatsAppNumber(user.contact_no), ...m.whatsapp },
    });

    revalidatePath("/admin/users");
    return { ok: true, message: `Approved ${user.full_name} as ${role}. ${describeReport(report)}` };
  } catch (err) {
    return failure(err);
  }
}

export async function rejectRequest(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const pm = await requireAccount("project_manager");
    const requestId = Number(form.get("requestId"));
    const note = String(form.get("note") ?? "").trim() || null;

    const [request] = await asActor<{ full_name: string; email: string; contact_no: string | null }>(
      pm.uid,
      (tx) => [
        tx`update account_requests set status = 'rejected', decision_note = ${note}
            where request_id = ${requestId} and status = 'pending'
           returning full_name, email, contact_no`,
      ]
    );
    if (!request) return { ok: false, message: "That request has already been decided." };

    // No account exists, so there is no one to hold an in-app notification:
    // email and WhatsApp only.
    const m = accountRejected({ name: request.full_name, note });
    const [email, whatsapp] = await Promise.all([
      sendEmail({ to: request.email, ...m.email }),
      sendWhatsApp({ to: toWhatsAppNumber(request.contact_no), ...m.whatsapp }),
    ]);

    revalidatePath("/admin/users");
    return { ok: true, message: `Declined ${request.full_name}. ${describeReport({ email, whatsapp })}` };
  } catch (err) {
    return failure(err);
  }
}
