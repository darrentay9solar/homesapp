# Access control (A.5.15–5.18, A.8.2–8.5)

Who can see and do what in GetHomeApps, how accounts start, change and end,
and the quarterly review. The rules are enforced by the database itself
(row-level guards on every table), so a mistake in a screen can't widen them;
the UAT tests every role against every action.

## Roles

| Role | Sees | Can't |
|---|---|---|
| **Homeowner** | Their own project and system only: progress, handover, invoices, their solar figures (no serial numbers) | Anyone else's anything; change project fields |
| **Contractor Admin** | Projects of their contractor groups: milestone fields, files they upload, EPC visits | Create or change project details; check in at sites |
| **EPC Team** | As Contractor Admin, plus GPS check-in/out at sites | Create or change project details |
| **Project Manager** | The projects they run (and those nobody runs), their files and check-ins, their plants' solar figures; approves accounts and role changes below manager | Other managers' projects; invoice amounts, issuing or marking invoices paid; manager accounts |
| **Admin** (finance) | Every project and system read-only; invoices and payments; every plant's figures | Change projects, accounts or maintenance records |
| **Superadmin** | Everything; the whole audit log; every account | Superadmins themselves are added only in the database |

Full lists: `lib/client/access.ts` (shown to each person in Account → Access).

**Privileged accounts.** Superadmins: at most 3, named in policies.md §2.
The database owner login and the production keys exist only in the release
laptop's `.env.local` and the suppliers' consoles, never in Vercel or in code.

## Signing in

- Clerk handles passwords (never stored by us), rate-limits guesses, refuses
  breached passwords, and checks a new device with an emailed code.
- **Two-step verification** (Account → Security): an authenticator app's
  6-digit code after the password, with 10 backup codes for a lost phone.
  With `REQUIRE_STAFF_MFA=1` (Vercel, Production) a staff member who signed
  in without it can open only their own account until they set it up.
- Staff are **signed out after 30 minutes without use** (a minute's warning).
- Sessions last as Clerk's settings say; signing out ends them everywhere
  when a password is changed.

## Joiners, movers, leavers

| When | What | Who | Record |
|---|---|---|---|
| **Joins** | Account created from People (or they sign up and are approved), with the role their job needs and nothing more; told to set up two-step on day one | A manager or superadmin | The audit log records who created and approved it |
| **Contractor or temporary** | As above, with a **Disables on** date | Manager | Account's expiry date |
| **Changes job** | Role changed (or requested in Account → Access and approved); groups and projects adjusted the same day | Manager / superadmin | Audit log |
| **Leaves** | Account **disabled the same day** (People → the person → Disable); devices and keys returned; any shared secrets they knew changed | Manager / superadmin | Audit log; leaver checklist |

Disabled accounts can't sign in; their records stay (needed for the contract
history) until retention removes them.

## The quarterly access review

Every quarter (January, April, July, October), a superadmin:

1. Opens **People → Access review (Excel)**. It lists everyone who can sign
   in: role, since when, last sign-in and two-step status (from Clerk), how
   many projects they can see, and any disable date.
2. Goes through each line: should this person still have this role? Anyone
   who hasn't signed in for 90 days, anyone without two-step, anyone whose
   job has changed: fill in *Keep as is?* and *Change to make*.
3. Makes the changes in People.
4. Fills in the **Sign-off** sheet (name, role, date, what changed) and saves
   the file in the company's records (_[folder]_). The next review is due
   91 days later.

The download itself is recorded (who, when, how many people).

## Evidence for the auditor

- This document and lib/client/access.ts (the rules).
- The UAT's per-role tests (tests_py/uat): every role against every action.
- The signed quarterly reviews.
- The audit log: account creations, approvals, role changes, disabling.
