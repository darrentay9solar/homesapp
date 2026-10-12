# Form rules and messages

Every form in the app works the same way: **its button always works**.
Pressing it with something wrong doesn't send anything; instead each field
that needs fixing turns into a red box with the reason in a solid red bar
under it ("!" and bold text), and a red summary sits above the button:
*Some details are missing or need fixing. See the fields marked in red.*
Before anything is pressed, the hints under the fields say the rules.

The rules live in one place, `lib/client/rules.ts`, in the same words as
the server's (`api/_lib/profile.py`). `tests_py/test_form_rules.py` runs
over 1,000 values through both and checks they accept and refuse exactly
the same ones, so a form can't look right and still be refused after
sending.

| Field | The rule | Where |
|---|---|---|
| Full name | At least 2 characters (spaces don't count) | Sign up, Request Access, New Account, Your Name |
| Email | Something@something.something | Sign up, Sign in, Forgot Password, New Account, Your Email |
| Mobile | The country code from the picker, then the number: a Singapore number is 8 digits after +65; others 8 to 15 digits in all | Sign up, Request Access, New Account, Your Mobile, Create Project |
| Password | At least 15 characters, and not one known from a data breach (Clerk checks it, at sign-up, password changes and sign-in). No other character rules. | Sign up, Forgot Password, Your Password |
| Code | All 6 digits | Email and phone verification |
| Postal code | Optional on accounts; 6 digits when given. Required on a project, and looked up on OneMap | Request Access, New Account, Create Project |
| NRIC | Optional; only the last 4: three digits and a letter, e.g. 567D | Request Access, New Account, a project's homeowner field |
| Account expiry | A date from tomorrow, or "No expiry" ticked | Approving a request, New Account, a person's dates |
| Group name | At least 3 characters | New Group |
| Project | Name, 6-digit postal code (found on OneMap), address, a homeowner (account or name), their mobile, a contractor (group, people or a name), a start or end date (the end not before the start) | Create / Edit Project |
| Site visit | A day from today on | Schedule Visit |
| Check in / out | At least 1 crew on site to check in; 0 or more leaving | Check In / Check Out |
| Handover | A drawn signature, the signer's name, and the box ticked | Sign certificate |
| Meeting | A title, at least one person, and a start time free for everyone | New Meeting |
| Blocked time | The end after the start, 62 days at most | Block Out Time |
| Maintenance check | The day it was done: not in the future, not before the turn-on | Mark done |
| Audit undo | A reason of at least 10 characters | Revert / Restore |
| Role request | Why you need it, at least 5 characters | Ask for a different role |

Clerk's own refusals (a wrong password, a breached password, the security
check not loading because of an ad blocker, too many attempts) are put in
plain words by `clerkMessage` in `components/auth.tsx`, and a password or
email problem is shown under that field.

## The language

The language chosen anywhere is the person's: on the sign-in or sign-up
screens (before signing in) it's remembered for a day and, the moment they
sign in, saved on their account (`users.language`); in the app, the 中/EN
button in every header and Account → Language save it straight away. Emails,
WhatsApp and SMS follow the saved language.
