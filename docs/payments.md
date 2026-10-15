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
