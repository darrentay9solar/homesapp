# Email, WhatsApp and SMS

The sending code is built (`api/_lib/notify.py`). Until the keys below exist,
every send is recorded as **skipped** with the reason, and the project manager
sees that on screen ("Email skipped — email not configured"). Nothing breaks.

## Why SMS and WhatsApp don't send yet

Nothing is wrong with the code: **none of the keys are set**. Vercel has no
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `SMS_FROM`, `RESEND_API_KEY` or `EMAIL_FROM`, so each send
is skipped and recorded so. Set them up in this order (the checklist at the end
lists every value):

1. **WhatsApp test number** (Step 1 below, 15 minutes): proves the wiring to
   up to 5 phones you choose.
2. **Templates** (Step 2): approval takes minutes to a day.
3. **Permanent token** (Step 3), then the settings (Step 4).
4. **Business verification + your own number** (Step 5): the long one; start it now.
5. **Twilio SMS** for people not on WhatsApp, after registering the sender
   name with SGNIC.
6. **Resend email** with your domain.

What gets sent:

| Event                                   | In-app + phone | Email | WhatsApp template (SMS if it fails) |
| --------------------------------------- | :------------: | :---: | ----------------------------------- |
| PM creates an account                   |       ✓        |   ✓   | `account_created`                   |
| Someone requests an account (→ PMs)     |       ✓        |   ✓   | —                                   |
| PM approves / declines a request        |       ✓        |   ✓   | `account_approved` / `account_rejected` |
| Someone asks for a different role (→ PMs) |     ✓        |   ✓   | —                                   |
| PM approves / declines a role change    |       ✓        |   ✓   | `role_changed` / `role_declined`    |
| Confirming a new mobile number          |       —        |   —   | `verification_code` (Authentication) |
| Visits, milestones, approvals, crews running late | ✓    |   —   | — (phone notification instead; see docs/alerts.md) |

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

**`role_changed`**

```
Hi {{1}}, your GetHomeApps role has been changed to {{2}}.
```

**`role_declined`**

```
Hi {{1}}, your request to become {{2}} in GetHomeApps wasn't approved. Your project manager can tell you more.
```

**`verification_code`**: a different kind of template. Choose category
**Authentication** (not Utility), then **Copy code** as the button type. Meta
writes the text itself ("*{{1}}* is your verification code."); tick "Add
security recommendation" and set the code to expire in **10 minutes**. The app
sends the code as both the text and the button's value. Authentication
messages cost about S$0.02 in Singapore. If this template isn't approved yet,
the code goes by SMS instead (when Twilio is set up).

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

---

## SMS fallback: Twilio

Every mobile message tries **WhatsApp first**. Only if WhatsApp doesn't go
out (not configured yet, the person isn't on WhatsApp, Meta refused it) is
the same message sent **by SMS** instead. Never both, so nothing is paid for
twice. Each attempt is recorded in `notification_deliveries`.

Cost: about **US$0.06 per SMS** to a Singapore number with a registered
sender name (US$0.04 from a plain number). 160 characters per segment; the
account messages fit in one or two.

**Singapore rule — register the sender name first.** Since 2023, SMS that
show a name ("9SolarHome") instead of a number must use a name registered
with SGNIC's **SMS Sender ID Registry (SSIR)**, by UEN, sent through a
participating provider (Twilio is one). Unregistered names are labelled
"Likely-SCAM" and IMDA is moving to block them outright. Registration has a
one-off and an annual fee per name — check sgnic.sg for current amounts.

Setup:

1. Sign up at <https://www.twilio.com>, upgrade from trial (trial accounts
   can only text verified numbers).
2. Register the sender name in SSIR (<https://www.sgnic.sg>), then follow
   Twilio's Singapore sender ID process to attach it to your account.
3. Messaging → Services → **Create Messaging Service**, add the sender.
4. Set in `.env.local` and Vercel, then redeploy:

   ```
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   SMS_FROM=MG...           # the Messaging Service SID
   ```

### Checklist: every setting

In `.env.local` (laptop) and Vercel → Settings → Environment Variables (all
environments), then redeploy:

| Setting                    | From                                              |
| -------------------------- | ------------------------------------------------- |
| `WHATSAPP_TOKEN`           | Step 3, the system user token                     |
| `WHATSAPP_PHONE_NUMBER_ID` | Step 1 (test number) or Step 5 (your own number)  |
| `TWILIO_ACCOUNT_SID`       | Twilio console, Account Info                      |
| `TWILIO_AUTH_TOKEN`        | Twilio console, Account Info                      |
| `SMS_FROM`                 | Your Messaging Service SID (starts `MG`)          |
| `RESEND_API_KEY`           | Resend → API Keys                                 |
| `EMAIL_FROM`               | e.g. `9 Solar Home <noreply@mail.yourdomain.sg>`  |

To check: Account → Mobile → Change, enter your own number. The message under
the code box says whether it came by WhatsApp or SMS. On a laptop with neither
set up, the code is shown on screen instead ("Development only").

### Phone numbers

The app converts what people type into WhatsApp's format: `+65 9123 4567`,
`9123 4567` and `6591234567` all become `6591234567`. A Singapore number
that isn't a mobile (e.g. a 6xxx landline) is skipped rather than guessed.
