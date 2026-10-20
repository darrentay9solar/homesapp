# Payments

How homeowners pay 9 Solar Home, and how the app keeps track (migration 0043;
`api/_routes/finance.py`, `api/_lib/invoices.py`, `components/finance.tsx`).

## The one plan

1. **Admin fee.** 3,500 (set in Payments → Invoice design), invoiced once per
   project. It's paid before the project moves to Maintenance: a project
   manager can't close a signed project until Admin has marked its fee paid
   (the database refuses it too).
2. **Monthly.** From the month a system is turned on, for 8 years (96 months):
   the kWh it generated that month times the rate per kWh in its contract
   (`maintenance_systems.rate_per_kwh`, from the client list), to the cent,
   half a cent rounding up. A month is invoiced once it's over.

## Who does what

| Who | What |
|---|---|
| **Admin** (account type `finance`, made by a superadmin) and superadmins | Everything below: the overview with amounts, every invoice, issuing, marking paid or void, the bank statement, the invoice's design, the QR. Every project and system to look at, read-only. |
| Project managers | Payments → whether each project's admin fee and each month is issued and paid, for what they run. No amounts. The project page shows the same. |
| Homeowners | Payments (on the phone's bar): what they owe, the PayNow QR, every invoice with its PDF, a receipt when it's paid, and "I've paid: send proof" (a photo or PDF). |
| Crew | Nothing about payments. |

## A month, step by step

1. **Payments → Issue a month**: last month is chosen. Each system billed that
   month is listed with its kWh (from its output record, if there is one) and
   the amount; type or correct the kWh, untick any to leave out, and press
   Issue. Each homeowner with an account is told (in the app, by email).
2. The homeowner pays with the QR, putting the invoice number (e.g.
   `INV-2026-00042`) as the reference.
3. **Payments → Bank statement**: upload the account's statement exported from
   the bank as CSV. Each money-in line that names an invoice number is matched
   to it ("Pays it", or "Amount differs" if the amount isn't the invoice's);
   tick the ones to mark paid and confirm. Or open an invoice and **Mark
   paid** by hand (for a payment without the reference, or with proof sent).
4. Paid invoices show as receipts; the homeowner is told.

An invoice is never deleted: a wrong one is voided (with a reason) and a new
one issued. Every change is in the audit log.

## Invoice design

Payments → Invoice design: the company's name, address, UEN, email and phone,
the logo and the PayNow QR (uploaded as pictures; turned into JPEG for the
PDF), the title, a colour, opening words, how to pay, terms and a footer, and
which parts show. The preview beside it is the PDF's layout with sample
figures. New PDFs use it at once. The PDF is written by the app itself
(Helvetica): names in Chinese characters show as "?" on the PDF, though the
app shows them correctly.

## Checking a payment arrived

A static QR can't tell the app it was paid; the bank statement (or Admin's
own check, with the homeowner's proof) does. If the company later uses a
payment gateway (HitPay, Stripe PayNow) that reports payments, it can mark
invoices paid by itself; ask for it then.

## GIRO deduction (proposal, not built yet)

Asked on 19 Oct 2026: how the process would run, and be recorded, if
homeowners pay the monthly amount by GIRO instead of PayNow. Nothing below is
built; it's the flow proposed for the team to agree.

**Once, for each homeowner who chooses GIRO**

1. The homeowner fills in the bank's GIRO form (Interbank GIRO / Direct Debit
   Authorisation, "DDA"): their bank and account, the maximum per
   deduction, and 9 Solar Home's reference for them. The app gives each
   system a GIRO reference (its project code) to put on the form.
2. Admin sends the form to 9 Solar Home's bank. The homeowner's bank
   approves or rejects it, usually in 2 to 4 weeks.
3. In the app, Admin records on the system: GIRO, its reference, the form
   (uploaded), sent on, and then approved on (or rejected, with why). Until
   it's approved the homeowner keeps paying by PayNow, and their invoices say
   so.

**Every month**

4. Admin issues the month's invoices as now. A GIRO homeowner's invoice says
   "Will be deducted by GIRO on [date]" instead of the PayNow QR.
5. Payments → GIRO run: the app lists the month's GIRO invoices and makes the
   collection file in the bank's own format (DBS IDEAL, OCBC Velocity and
   UOB Infinity each have one): each homeowner's reference, amount and
   invoice number. Admin downloads it and uploads it to the bank before the
   bank's cut-off. The run is recorded (who, when, how many, the total).
6. On the deduction date the bank collects. Its result file (or the
   statement) lists each deduction as paid or rejected (insufficient funds,
   account closed, DDA cancelled).
7. Admin uploads the result to the app, as the bank statement is uploaded
   now: each paid deduction marks its invoice paid "by GIRO" with the bank's
   reference; each rejected one stays unpaid, marked "GIRO rejected: [why]".
8. A rejected deduction tells the homeowner (in the app and by email) and
   Admin. It's tried again in the next run, or the homeowner pays it by
   PayNow; after a set number of failures Admin is asked to follow up.

**What the app would need**

- On each system: payment method (PayNow or GIRO), GIRO reference, status
  (form sent, approved, rejected, cancelled), the form, and the dates.
- A GIRO run: its month, the bank file made, when it went to the bank, and
  each deduction's result.
- Invoices: paid "by GIRO", with the run and the bank's reference; a
  rejected deduction kept on the invoice's history.
- Everything audited, like the rest of Payments.

**For the team to decide first**

- Which bank, and which of its collection file formats (the bank gives a
  sample file and the cut-off times).
- The deduction day (for example the 15th, after invoices go out on the 1st).
- What happens after a rejected deduction: retry next month, a fee, or PayNow.
- Whether the admin fee can also be deducted, or stays PayNow.
