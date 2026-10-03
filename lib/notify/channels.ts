/**
 * The two outbound channels. Plain fetch, no SDKs: each is one HTTPS call,
 * and an SDK would be a dependency to audit for the sake of a JSON body.
 *
 * Both are optional. Without their keys a send returns "skipped" with the
 * reason, which is recorded against the notification — so the app works
 * before the accounts exist, and it is obvious afterwards which messages
 * never went out.
 */

export type SendResult =
  | { status: "sent"; providerMessageId: string | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

// ------------------------------------------------------------------ email

/**
 * Email through Resend (resend.com). Free up to 3,000 a month.
 *
 * EMAIL_FROM must be on a domain verified in Resend. Until one is, Resend's
 * shared "onboarding@resend.dev" sender works but delivers only to the
 * address that owns the Resend account — enough to test, not to go live.
 */
export async function sendEmail(msg: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!key || !from) {
    return { status: "skipped", reason: "email not configured (RESEND_API_KEY / EMAIL_FROM)" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { status: "failed", error: `Resend ${res.status}: ${body.message ?? "error"}` };
    return { status: "sent", providerMessageId: body.id ?? null };
  } catch (err) {
    return { status: "failed", error: `Resend unreachable: ${err instanceof Error ? err.message : err}` };
  }
}

// --------------------------------------------------------------- whatsapp

/**
 * Turns how people write Singapore numbers into what WhatsApp wants:
 * country code and digits, no plus, no spaces. "+65 9123 4567", "9123 4567"
 * and "6591234567" all become "6591234567". Returns null for anything that
 * cannot be a mobile number, rather than guessing.
 */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  // A bare 8-digit Singapore mobile starts with 8 or 9.
  if (/^[89]\d{7}$/.test(digits)) return `65${digits}`;
  // Anything already carrying a country code: E.164 allows 8–15 digits.
  if (raw.trim().startsWith("+") || digits.startsWith("65")) {
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }
  return null;
}

/**
 * WhatsApp through Meta's Cloud API.
 *
 * Business-initiated messages must use a template Meta has approved in
 * advance; free text is only allowed within 24 hours of the person
 * messaging the business. So every message here names a template and fills
 * its {{1}}, {{2}}… placeholders, in order.
 */
export async function sendWhatsApp(msg: {
  to: string | null;
  template: string;
  params: string[];
}): Promise<SendResult> {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneId) {
    return {
      status: "skipped",
      reason: "WhatsApp not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)",
    };
  }
  if (!msg.to) return { status: "skipped", reason: "no usable mobile number on file" };

  const version = process.env.WHATSAPP_API_VERSION?.trim() || "v25.0";
  const language = process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "en";

  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to,
        type: "template",
        template: {
          name: msg.template,
          language: { code: language },
          components: [
            {
              type: "body",
              parameters: msg.params.map((text) => ({ type: "text", text })),
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string; code?: number };
    };
    if (!res.ok) {
      return {
        status: "failed",
        error: `WhatsApp ${res.status}${body.error?.code ? ` (${body.error.code})` : ""}: ${
          body.error?.message ?? "error"
        }`,
      };
    }
    return { status: "sent", providerMessageId: body.messages?.[0]?.id ?? null };
  } catch (err) {
    return { status: "failed", error: `WhatsApp unreachable: ${err instanceof Error ? err.message : err}` };
  }
}
