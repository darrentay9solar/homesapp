import { sql } from "@/lib/db";

import { type SendResult, sendEmail, sendWhatsApp } from "./channels";

export { toWhatsAppNumber } from "./channels";

type Kind =
  | "account_created"
  | "account_request"
  | "account_approved"
  | "account_rejected";

export type Outbound = {
  recipientUid: number;
  kind: Kind;
  /** Shown in the app's notification list. */
  title: string;
  body: string;
  projectId?: number | null;
  email?: { to: string; subject: string; html: string; text: string };
  whatsapp?: { to: string | null; template: string; params: string[] };
};

export type NotifyReport = {
  email?: SendResult;
  whatsapp?: SendResult;
};

/**
 * Records a notification, sends it on each channel given, and records how
 * each send went.
 *
 * Ids are drawn from the sequences up front instead of using RETURNING. The
 * notifications tables have row level security that lets only the recipient
 * read a row, and Postgres applies that to RETURNING too — so a project
 * manager notifying someone else would be refused their own insert.
 *
 * Deliveries are written after the attempt, with its final status, for the
 * same reason: updating a row you cannot read is not possible either.
 * A send that succeeds and then fails to be recorded is the one gap; the
 * scheduled retry job (still to come) will reconcile against the provider.
 */
export async function notify(msg: Outbound): Promise<NotifyReport> {
  const db = sql();
  const [{ id }] = (await db`
    select nextval(pg_get_serial_sequence('notifications', 'notification_id'))::bigint as id`) as Array<{
    id: string;
  }>;

  await db`
    insert into notifications (notification_id, recipient_uid, project_id, kind, title, body)
    values (${id}, ${msg.recipientUid}, ${msg.projectId ?? null}, ${msg.kind}, ${msg.title}, ${msg.body})`;

  const report: NotifyReport = {};
  const attempts: Array<Promise<void>> = [];

  if (msg.email) {
    const email = msg.email;
    attempts.push(
      sendEmail(email).then(async (r) => {
        report.email = r;
        await recordDelivery(id, "email", r);
      })
    );
  }
  if (msg.whatsapp) {
    const wa = msg.whatsapp;
    attempts.push(
      sendWhatsApp(wa).then(async (r) => {
        report.whatsapp = r;
        await recordDelivery(id, "whatsapp", r);
      })
    );
  }

  await Promise.all(attempts);
  return report;
}

async function recordDelivery(notificationId: string, channel: "email" | "whatsapp", r: SendResult) {
  const db = sql();
  await db`
    insert into notification_deliveries
      (notification_id, channel, status, sent_at, failed_at, error, provider_message_id)
    values (
      ${notificationId}, ${channel}, ${r.status},
      ${r.status === "sent" ? new Date().toISOString() : null},
      ${r.status === "failed" ? new Date().toISOString() : null},
      ${r.status === "failed" ? r.error : r.status === "skipped" ? r.reason : null},
      ${r.status === "sent" ? r.providerMessageId : null}
    )`;
}

/** One line a PM can read: "email sent · WhatsApp skipped (no number)". */
export function describeReport(report: NotifyReport): string {
  const part = (label: string, r?: SendResult) => {
    if (!r) return null;
    if (r.status === "sent") return `${label} sent`;
    if (r.status === "skipped") return `${label} skipped — ${r.reason}`;
    return `${label} FAILED — ${r.error}`;
  };
  return [part("Email", report.email), part("WhatsApp", report.whatsapp)].filter(Boolean).join(" · ");
}
