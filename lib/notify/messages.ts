/**
 * The words of every account message, in one place.
 *
 * WhatsApp template names and the order of their parameters must match what
 * was approved in Meta's WhatsApp Manager exactly — see docs/whatsapp.md for
 * the text to submit. If a template is edited there, edit it here too.
 */

const BRAND = "9 Solar Home";

export function appUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  // Vercel sets these; the production one is the stable domain rather than
  // this deployment's unique URL.
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function emailShell(heading: string, paragraphs: string[], cta?: { label: string; url: string }) {
  const html = `<!doctype html><html><body style="margin:0;background:#000000;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0e1011;border-radius:14px;padding:28px;color:#e8efe9">
<tr><td style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#16c47f;font-weight:700">${BRAND}</td></tr>
<tr><td style="font-size:22px;font-weight:700;padding:10px 0 6px">${escape(heading)}</td></tr>
${paragraphs.map((p) => `<tr><td style="font-size:15px;line-height:1.55;color:#c4cfc7;padding:6px 0">${escape(p)}</td></tr>`).join("")}
${
  cta
    ? `<tr><td style="padding:20px 0 4px"><a href="${escape(cta.url)}" style="display:inline-block;background:#16c47f;color:#06120a;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px">${escape(cta.label)}</a></td></tr>
<tr><td style="font-size:12px;color:#7d8a80;padding-top:10px;word-break:break-all">Or open: ${escape(cta.url)}</td></tr>`
    : ""
}
</table></td></tr></table></body></html>`;
  const text = [heading, "", ...paragraphs, ...(cta ? ["", `${cta.label}: ${cta.url}`] : []), "", `— ${BRAND}`].join("\n");
  return { html, text };
}

/** A project manager created this person's account. */
export function accountCreated(p: { name: string; role: string; url: string }) {
  const { html, text } = emailShell(
    `Your GetHomeApps account is ready`,
    [
      `Hi ${p.name},`,
      `${BRAND} has created a GetHomeApps account for you as ${p.role}.`,
      `Use the button below to set your password and sign in. The link is personal to you — please don't forward it.`,
    ],
    { label: "Set up my account", url: p.url }
  );
  return {
    email: { subject: `${BRAND}: your GetHomeApps account (${p.role})`, html, text },
    whatsapp: { template: "account_created", params: [p.name, p.role, p.url] },
    inApp: { title: "Welcome to GetHomeApps", body: `Your account was created as ${p.role}.` },
  };
}

/** Someone asked for an account; sent to every active project manager. */
export function accountRequested(p: { requester: string; email: string; role: string; url: string }) {
  const { html, text } = emailShell(
    "New account request",
    [`${p.requester} (${p.email}) has asked for a GetHomeApps account as ${p.role}.`, "Review it to approve or decline."],
    { label: "Review request", url: p.url }
  );
  return {
    email: { subject: `${BRAND}: account request from ${p.requester}`, html, text },
    inApp: { title: "New account request", body: `${p.requester} asked to join as ${p.role}.` },
  };
}

export function accountApproved(p: { name: string; role: string; url: string }) {
  const { html, text } = emailShell(
    "Your account has been approved",
    [`Hi ${p.name},`, `Your GetHomeApps account request has been approved. You're set up as ${p.role}.`],
    { label: "Open GetHomeApps", url: p.url }
  );
  return {
    email: { subject: `${BRAND}: account approved`, html, text },
    whatsapp: { template: "account_approved", params: [p.name, p.role, p.url] },
    inApp: { title: "Account approved", body: `You're set up as ${p.role}.` },
  };
}

export function accountRejected(p: { name: string; note: string | null }) {
  const { html, text } = emailShell("About your account request", [
    `Hi ${p.name},`,
    `Your request for a GetHomeApps account wasn't approved.`,
    ...(p.note ? [`Note from ${BRAND}: ${p.note}`] : []),
    `If you think this is a mistake, please contact your ${BRAND} project manager.`,
  ]);
  return {
    email: { subject: `${BRAND}: account request`, html, text },
    whatsapp: { template: "account_rejected", params: [p.name] },
  };
}
