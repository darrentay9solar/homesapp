# Email and WhatsApp notifications

The sending code is built (`lib/notify/`). Until the keys below exist, every
send is recorded as **skipped** with the reason, and the project manager sees
that on screen ("Email skipped — email not configured"). Nothing breaks.

What gets sent today:

| Event                               | In-app | Email | WhatsApp template  |
| ----------------------------------- | :----: | :---: | ------------------ |
| PM creates an account               |   ✓    |   ✓   | `account_created`  |
| Someone requests an account (→ PMs) |   ✓    |   ✓   | —                  |
| PM approves a request               |   ✓    |   ✓   | `account_approved` |
| PM declines a request               |   —    |   ✓   | `account_rejected` |

Every attempt is stored in `notification_deliveries` with its status and the
provider's message id.

---

## Email: Resend

Free up to 3,000 emails a month.

1. Sign up at <https://resend.com>.
2. **Domains → Add domain** — use a domain 9 Solar Home owns (e.g.
   `mail.yourdomain.sg`). Add the DNS records Resend shows (SPF, DKIM) at your
   domain registrar. Verification usually takes minutes.
3. **API Keys → Create API key** — permission "Sending access", restricted to
   that domain.
4. Set in `.env.local` and in Vercel (all environments), then redeploy:

   ```
   RESEND_API_KEY=re_...
   EMAIL_FROM=9 Solar Home <noreply@mail.yourdomain.sg>
   ```

Before the domain is verified you can test with
`EMAIL_FROM=onboarding@resend.dev`, but Resend then delivers **only to the
email address that owns the Resend account**.

---

## WhatsApp: Meta Cloud API

### What it costs (Singapore, October 2026)

Meta charges per delivered template message. Account messages are "utility"
templates: about **S$0.02 (US$0.016) each**. Marketing templates are ~S$0.09,
but nothing here is marketing. 2,000 messages a month ≈ S$40.

There is no monthly fee when you go direct to Meta (no Twilio etc. needed).

### Step 1 — Start testing today (no verification needed)

1. Go to <https://developers.facebook.com> → **My Apps → Create App** →
   use case **"Connect with customers through WhatsApp"** → business
   portfolio: create one for 9 Solar Home if you don't have one.
2. In the app: **WhatsApp → API Setup**. Meta gives you a free **test phone
   number** and a temporary 24-hour token.
3. Under "To", **add up to 5 recipient numbers** (your own mobile, etc.) and
   confirm each with the code WhatsApp sends.
4. Copy the **Phone number ID** (not the phone number itself).

The test number can send only to those 5 numbers and only Meta's sample
`hello_world` template until your own templates are approved — enough to
prove the wiring.

### Step 2 — Create the templates

**WhatsApp Manager → Message templates → Create template**. Category
**Utility**, language **English**. The body text must have its `{{n}}`
placeholders in exactly this order — the app fills them in that order.

**`account_created`**

```
Hi {{1}}, 9 Solar Home has created your GetHomeApps account as {{2}}.
Set up your login here: {{3}}
This link is personal to you, please don't forward it.
```

**`account_approved`**

```
Hi {{1}}, your GetHomeApps account request has been approved. You're set up as {{2}}.
Open the app: {{3}}
```

**`account_rejected`**

```
Hi {{1}}, your request for a GetHomeApps account wasn't approved. If you think this is a mistake, please contact your 9 Solar Home project manager.
```

Meta asks for sample values for each placeholder (e.g. "Tan Wei Ming",
"Homeowner", "https://homesapp-alpha.vercel.app"). Approval is usually
minutes to a day. If Meta re-categorises one as Marketing, edit the wording
to be plainly about the account and resubmit.

### Step 3 — A permanent token

The 24-hour token on the API Setup page will expire. Instead:

1. <https://business.facebook.com> → **Settings → Users → System users →
   Add** → name `gethomeapps`, role **Admin**.
2. **Assign assets** → your WhatsApp app → full control; and your WhatsApp
   Business Account → full control.
3. **Generate new token** → your app → expiry **Never** → permissions
   `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Copy it (shown once).

### Step 4 — Configure

`.env.local` and Vercel (all environments), then redeploy:

```
WHATSAPP_TOKEN=<system user token>
WHATSAPP_PHONE_NUMBER_ID=<phone number id>
```

### Step 5 — Go live with your own number (the long-lead item)

To message anyone (not just 5 test numbers) from 9 Solar Home's own number:

1. **Business verification**: Business Settings → Security Centre → Start
   verification. Needs the ACRA business profile / UEN and a matching
   website or utility bill. Takes from a couple of days to a few weeks —
   **start this now**.
2. **Add your phone number** in WhatsApp Manager → Phone numbers. It must
   not currently be registered on the WhatsApp or WhatsApp Business app
   (delete it from the app first, or use a new number). Set the display
   name to "9 Solar Home"; Meta reviews it.
3. Swap `WHATSAPP_PHONE_NUMBER_ID` to the new number's id and redeploy.
   Templates belong to the business account, so they carry over.

New numbers start at 250 business-initiated messages per 24 hours and rise
automatically with good quality ratings — ample for account notices.

### Phone numbers

The app converts what people type into WhatsApp's format: `+65 9123 4567`,
`9123 4567` and `6591234567` all become `6591234567`. A Singapore number
that isn't a mobile (e.g. a 6xxx landline) is skipped rather than guessed.
