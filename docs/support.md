# Support and the assistant

A homeowner asks a question in **Help**. The assistant answers what it can
straight away; anything else goes to a person: the project's manager, who
can bring in anyone with an account to help settle it.

## Who does what

| Who | What they can do |
|---|---|
| Homeowner | Ask (Help, under More on a phone). Talk with the assistant, then **Talk to a person**. Write, settle, reopen. |
| Contractor, EPC crew | Ask (Support, under More): their question goes straight to a person. Write in conversations they're added to. |
| Project manager | Sees the conversations about projects they run, and any handed to them. Answers, **Add someone** (anyone with an account, on the project or not), takes them out again, **Hand to another manager**, settles and reopens. Keeps the assistant's **Answers**. |
| Superadmin | All of that, for every conversation, including those about projects with no manager. |

The asker always stays in their conversation. Everyone added is told (in
Alerts, on the phone and by email) and sees the whole conversation. Taken
out, they no longer see it.

## A conversation's states

| State | Means | Moves on when |
|---|---|---|
| With the assistant | A homeowner and the assistant | They tap **Talk to a person** |
| Waiting for a person | Asked for a person; nobody has answered yet | Someone from 9 Solar Home writes |
| In progress | A person is on it | Either side marks it **settled** |
| Settled | Done | Either side reopens it, or the asker writes again |

When a person is asked for, the project's manager is told by alert and
email, with the question; with no manager, every superadmin is. Someone still
waiting after a day: the superadmins are told once, and it's the first line
of the morning summary ("People waiting for a support answer").

## The assistant

It answers from two things only: the **Answers** project managers keep
(Support → Answers, in English and optionally Chinese) and the asker's own
project (its stage, dates, visits, system, PPA, plan and checks). Nothing
about anyone else ever reaches it.

- **With an Anthropic key** (`ANTHROPIC_API_KEY`, step 11 of
  [YOUR_STEPS.md](YOUR_STEPS.md)) Claude answers in its own words, in the
  asker's language, briefly. It never guesses dates, costs or warranties
  that aren't written down. A fault, safety, billing, a complaint, or
  anything it isn't sure of: it says the project manager can help. Anyone
  in danger is told to call 995.
- **Without a key**, on the demo, or if Claude can't be reached, it gives
  the closest answer from the list itself, or says it isn't sure and offers
  a person.
- 30 answers per person per day; after that it offers a person.
- **Add the starter answers** puts in seven about using the app (checks,
  booking, signing, the certificate, stages, mobile and language,
  notifications). 9 Solar Home adds its own: warranty, billing, cleaning,
  low generation, outages.

## Records

Conversations aren't deleted by anyone: they're settled, and a settled
conversation goes a year later with the rest of the non-essential data
([pdpa.md](pdpa.md), migration 0045). What was said can't be edited. Who asked, who was added or taken out, status changes and every
change to an answer are in the audit log (Support); answers are turned off,
never deleted. The database enforces all of this (migration 0036) as well
as the API (`api/_routes/support.py`).

## Tests

`tests_py/test_support.py` (the API, the assistant with Claude replaced, the
database's own rules, the warnings) and `tests/support.test.ts` (tabs,
wording, day labels).
