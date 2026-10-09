# Test cases

| File | Cases | What |
|---|---|---|
| `tests_py/test_upload_cases.py` | 450 | Uploading pictures and documents |
| `tests_py/test_gps_cases.py` | 631 | GPS location |
| `tests_py/test_r2_setup.py` | 1,470 | Cloudflare R2, development and production |
| `tests_py/test_full_flow.py` | 44 | One project from creation to closed, through the signed certificate, twice |
| `tests_py/test_analytics.py` | 69 | The dashboard's figures from hand-made projects; periods; regions, salespeople, kWp; who may see it |
| `tests/analytics.test.ts` | 33 | Axis steps, percentages, kWp, days, change arrows, column names |
| `tests_py/test_maintenance.py` | 102 | Maintenance: a handed-over project converting (once, audited), who sees and changes what, every field's checks, the database's guard and value rules, the Projects list leaving handed-over projects out, and the listing import read strictly |
| `tests/maintenance.test.ts` | 42 | How a system reads (PPA, plan, panels, inverters) in English and Chinese, the tabs, search, order, months added as the listing does |
| `tests_py/uat/` | 19,621 | User acceptance: every role at every stage against the brief (below) |
| `tests_py/test_account_settings.py` | 29 | Name, email, mobile codes, password, role requests, My Files |
| `tests_py/test_alerts.py` | 46 | Alerts, phone notifications (Web Push), crews running late |
| `tests/search.test.ts` | 146 | Every search in the app (projects, people, audit, My Files, form pickers) |
| `tests/alerts.test.ts` | 22 | The Alerts screen and which devices can get notifications |

Each case is one pytest test, run against the real API and the real database
rules on the Neon **test** branch. Nothing touches dev or production data.

```bash
npm run test:py    # everything except the requests to R2 (those are skipped) and the UAT suite
npm run test:uat   # the user acceptance tests (about 15 minutes)
npm run test:r2    # only the 39 tests that use the real R2 dev bucket (~85 requests)
```

**Last run (9 Oct 2026): 3,076 Python tests passed (43 skipped: the ones that use real R2), all 19,621 UAT tests passed, and 442 front-end tests.**

---

## User acceptance: `tests_py/uat/` (19,621)

The brief's rules are written down once, in plain terms, in
`tests_py/uat/spec.py`. Every test asks the real API (or the database
directly) and compares the answer with that file, so a disagreement means
either the app or the written rule is wrong.

**The world** (`uat/world.py`): eleven people and a project at each of eleven
stages, with real files in laptop storage and a real signed certificate.

| People | Stages |
|---|---|
| a superadmin; the PM running the projects; another PM; a contractor admin and an EPC member of the project's group; an EPC member assigned by name; a contractor admin and an EPC member of another group; the homeowner; another homeowner; an EPC member whose account is off | Draft, Awaiting Homeowner, Declined, Homeowner Approved, PM Approved, In Progress (nothing done / Milestone 1 / Milestone 2), Awaiting E-Sign, Signed, Closed |

| File | Cases | What's checked |
|---|---|---|
| `test_uat_access.py` | 803 | 11 people × 11 stages: the project page, its fields, site visits, handover and signed PDF; whether it's in their list; whether its files open; who gets the Create button. |
| `test_uat_fields.py` | 7,757 | Every field (45) for everyone who can see the project at every stage: its lock and the exact reason, each section's lock, what's filled, the milestone reached, and which buttons show. Then 3,751 real saves: 11 people × 11 stages × 31 fields, each refused or accepted as the brief says, and the first save on an approved project starting it. |
| `test_uat_uploads.py` | 1,767 | Every upload slot (14) × 11 people × 11 stages; the server picks where a file goes and writes the link down. Disallowed types and sizes, made-up slots, keys from another project or slot, and a file that never arrived. |
| `test_uat_actions.py` | 1,587 | Approve, decline, remind, reopen 1/2/3, ask for signature, remind to sign, sign (with a stale certificate), close and edit details, for 11 people at 11 stages. A press that should work runs on a fresh project and the test checks where it ends up; a refused one changes nothing. Scheduling and cancelling visits, checking in and out, one open check-in each, and check-ins 150 m to 20 km away refused. |
| `test_uat_database.py` | 1,749 | The database on its own, through the app's login: 11 people × 11 stages × 9 statuses for every status change; who may sign, change or delete a signature; adding files and changing fields at handover; closing stamps who and when; who may ask for the signature. |
| `test_uat_flows.py` | 39 | Whole stories through the API: start to finish five ways (different people doing each milestone), decline and ask again, a typed homeowner linked later, milestones opening in order, fixed milestones and reopening, a conditional date cleared, signing only what was seen (a rename mid-signature is caught), nine ways a signature can be incomplete, reopening withdraws the request, the crew locked out at handover, the signed PDF, closing only after signing, a superadmin closing, older projects sent for signature, reminders, another PM seeing nothing, a superadmin handing a project to another PM, who creates projects, Chinese and English emails, and who hears what. |
| `test_uat_language.py` | 2,629 | Every phrase in the dictionary (1,500+) translates, and every pattern keeps its filled-in parts; long phrases are really Chinese. Every email and text (11 kinds × 3 names × 4 roles) in Chinese with no English sentence left, and in English. Verification codes; WhatsApp template languages; falling back to English only when Meta has no Chinese version. |
| `test_uat_certificate.py` | 105 | The certificate reads like the project; panels and system size; grid connection; missing values; any change on it changes the fingerprint and nothing else does; the PDF (6 names, including Chinese and punctuation, × 7 signature images) is valid, one page, with the signature, time and fingerprint; which signature images are accepted, and broken ones refused. |
| `test_uat_people.py` | 98 | Who creates which accounts (11 people × 5 roles); a new account greeted in the chosen language, and unknown languages falling back to English; who may check file storage and read the audit log; another PM reads nothing of a project they don't run. |
| `test_uat_dashboard.py` | 450 | **Lab:** eight projects with known histories over 400 days, run by their own PM; every figure checked against a hand-worked answer for each period (tiles and their drop-down lists, change arrows, pipeline, on-time, days per stage, project length, how late, due soon, site work, heatmap, scorecard, capacity, approval rate, regions, retailers, salespeople, trend columns, sign-ups, the PM row). **World:** for every PM and superadmin at every period, each project in the right tile and stage, never a project the reader can't see, every number adding up, and the same late and no-show flags as the Projects list. |
| `test_uat_maintenance.py` | 2,358 | **Maintenance.** The world's handed-over project became a record with its people and system, and nothing else did; the list's handed-over count; Completed and Handed Over. 11 people × 4 kinds of record (a PM's, another PM's, unassigned, a converted project) × open, change, reopen a check and assign. 28 good and 24 bad changes by a superadmin, a PM and another PM, each kept or refused with nothing moved, and audited. 80 due/done combinations, marking done on 7 dates; 216 listing rows (PPA × plan × phase × panels) and 13 wrong values that stop the import; every turn-on day of 2027–2028 plus 6 and 12 months. |
| `test_uat_sweep.py` | 16 | Uploads abandoned for over a day are deleted, recent ones left; registered files, signed certificates and files taken off a project are never touched; the 15-minute job runs the sweep and needs its secret. |

The UAT run found and fixed three bugs in the app: a closed project's page
failed while counting its days; a PM couldn't clear a conditional date that
no longer applied in a completed milestone; and declining an account request
on the demo site would still have sent a real email.

---

## Uploads: `tests_py/test_upload_cases.py` (450)

| Group | Cases | What's checked |
|---|---|---|
| Signing | 16 | The Cloudflare R2 link signature reproduces **Amazon's published example signature exactly**. It doesn't change when signed twice, and changing any one of 11 inputs changes it. Upload links lock the file's type and size into the signature; R2 links use the bucket's path and expire after 5 minutes; the storage mode follows the environment. |
| Local links | 35 | Genuine upload and download links work. Changing any part of a link or its signature, an expired link (1 s to 1 day old), a made-up signature, or malformed text is refused. |
| Paths | 15 | 10 attempts to escape the storage folder (`../`, absolute paths, Windows paths) are refused; ordinary keys stay inside it. |
| Accepted | 42 | Every allowed type (JPEG, PNG, WebP, HEIC, HEIF, PDF) into every open slot (7). The storage key is chosen by the server, in the right project and slot, with the right extension. |
| Refused | 60 | 15 disallowed types (HTML, SVG, ZIP, EXE, GIF, Word, JSON…) in 2 slots. Sizes 0, −1 and over 25 MB refused; 1 byte to exactly 25 MB accepted. 8 slots that don't exist refused. |
| Round trips | 40 | Upload → confirm → download, with the bytes compared exactly, for every type at 1 B, 100 B, 4 KB, 64 KB and 1 MB. Also 10 kinds of file name: Chinese, accents, emoji, 300 characters (kept to 200), blank (saved as "file"), quotes, slashes and `<script>`. |
| Tampering | 15 | A file larger or smaller than approved, or of a different type, is refused. A download link can't be used to upload, an expired upload link is refused, made-up links are refused, and a dropped upload can be retried. |
| Forged confirmations | 14 | Confirming a key that wasn't issued is refused: another project, another slot, a wrong extension, path tricks, a bad ID, a missing extension. So is a file that never arrived; a stored file of the wrong type, which is also deleted; and one over the limit. |
| Who may upload | 196 | 7 roles × 7 project stages × 4 sections. **PM:** any open section. **Crew:** open sections, except a completed milestone. **Homeowner:** never. **Outsiders:** don't see the project. Nothing before both approvals; Milestone 2 and 3 sections only after the one before. |
| Opening and removing | 18 | PM, crew and homeowner can open a file; outsiders can't. PM and crew can remove one; the homeowner and outsiders can't. The crew can't remove from a completed milestone. A missing file, removal through another project, and an expired download link are all refused. |
| Photos | 6 | 1, 2, 3, 5 and 8 photos in one slot are all counted. Removing every photo empties the slot. |

## GPS location: `tests_py/test_gps_cases.py` (631)

The rules: a phone fix accurate to **50 m or better**, within the project's radius (**100 m** unless set otherwise), measured on the server. The crew sees one message for every refusal ("You're currently not receiving GPS signal…"), never the distance.

| Group | Cases | What's checked |
|---|---|---|
| Distance | 160 | The database's distance matches points placed at exact distances (1 m to 5 km) in 8 directions, to within a millionth of a metre. |
| Fence | 324 | 12 distances (0 m to 20 km, including 99.9 m and 100.5 m) × 9 accuracy readings (missing, 0 m to 200 m, including 49.9 m, 50 m and 50.1 m) × 3 directions. Accepted only when the fix is good and the crew is inside the fence. The recorded distance is the server's own, and a refusal never reveals the distance. |
| Radius | 20 | Radii of 25, 50, 150, 300 and 1,000 m, tested at 50%, 99%, 101% and 200% of the radius. |
| Sites | 20 | 10 real places (Changi, Jurong East, Woodlands, Sentosa, Tuas, Punggol, Pasir Ris, Bukit Timah, Marina Bay, Pulau Ubin), 60 m away (accepted) and 160 m away (refused). |
| Inputs | 15 | The crew count must be at least 1; missing coordinates are refused; check-out details can't arrive with the check-in. A site with no location refuses check-in. The time comes from the server, not the phone, and so does the recorded distance. |
| Who and when | 17 | **Who:** only the EPC crew on the project can check in, and only as themselves (not the contractor admin, an outsider, the homeowner, a PM, or nobody). **When:** only while the project is approved or in progress. **Afterwards:** nobody can delete a check-in. A PM can correct the crew count but can't check out for the crew, and one crew member can't check out another. |
| Check-out | 36 | Check-out is fenced the same way (5 distances × 4 accuracy readings) and needs a crew count of 0 or more. Where and when they arrived or left can't be changed, but crew counts can still be corrected. Leaving details are recorded only at check-out. |
| One at a time | 4 | One open check-in per person per site. They can check in again after checking out; two crew members can be on site together; one person can be open on two sites. |
| Postal code | 3 | A new postal code clears the old location, unless new coordinates come with it. Check-in is refused until the new site is located. |
| OneMap | 32 | Read from sample OneMap replies:<ul><li>a postal code picks its own building among neighbours, or reports not found</li><li>an address with close matches resolves; one matching places far apart is ambiguous</li><li>replies without coordinates are skipped; a "NIL" postal code is recorded as none</li><li>short queries and malformed postal codes are refused</li><li>a postal code wins over an address, and an address fills in its postal code</li><li>OneMap busy (it retries, then gives up), OneMap down, no network</li></ul>Plus **5 real lookups** (Ang Mo Kio, Orchard, Marina, Jurong, Changi): each returns its own building, inside Singapore. |

---

## Cloudflare R2 setup: `tests_py/test_r2_setup.py` (1,470)

Checks R2 is set up properly for development and production. Only the
**Live** group contacts Cloudflare, and only with `npm run test:r2`: about 30
requests with tiny files, all deleted afterwards. That's nothing against the free 1 million writes and
10 million reads a month. Every other case checks the links the app signs
with an independent signature check, the same way R2 checks them, without
sending anything. The rest of the suite never touches R2: in tests, uploads
go to `web/.uploads/`.

```bash
.venv/Scripts/python.exe -m pytest -q tests_py/test_r2_setup.py --r2-live   # all 1,470
.venv/Scripts/python.exe -m pytest -q tests_py/test_r2_setup.py             # 1,449, without contacting R2
```

**Last run: 1,470 passed.**

| Group | Cases | What's checked |
|---|---|---|
| Settings | 15 | The four R2 settings are in `.env.local`, with no stray quotes or spaces. The Account ID and Access Key ID are 32 characters and the secret is 64. The laptop uses `gethomeapps-dev`. The keys never appear when the settings are printed. |
| Where uploads go | 80 | Every combination of the four settings (16) on a laptop and on Vercel Production, Preview and Development: R2 only with all four; the laptop folder on a laptop otherwise; uploads off on Vercel otherwise. |
| Storage check | 39 | The PM's `/api/py/storage/check` explains every answer R2 can give (key accepted, no such bucket, key refused, bad signature, R2 error, rate limit, unreachable, timeout) on a laptop and on production, and never shows a key. It flags the dev bucket on production and the prod bucket anywhere else, without contacting R2. Only a signed-in PM can run it. `/ping` says where uploads go. |
| Upload links (app) | 896 | 14 file slots × 3 project stages × 6 types: R2 never changes who may upload what, or when, compared with laptop storage. 7 slots × 6 types × 14 sizes (1 B to 100 MB, 0, −1): links only for 1 B to 25 MB. 8 disallowed types get no link. Every link goes to the right account and bucket, uses a server-chosen key in the right project and slot, lasts 5 minutes, and has a signature that verifies for exactly that type and size. |
| Upload links (storage) | 252 | Every file slot (14) × type (6) × 3 sizes, signed straight from storage, verified the same way. |
| Viewing files | 120 | 60 file names come back exactly in the download, both straight from storage and through the app's `/files/<id>`. They include Chinese, Tamil, Japanese, Korean, emoji, flags, quotes, semicolons, `%`, `+`, `#`, newlines, NUL, `../`, Windows paths, `<script>`, right-to-left and zero-width characters. Only safe characters reach the header. Someone outside the project gets no link. |
| Link binding | 39 | A link is refused for anything it wasn't signed for: another method, type, size, key, slot, project, extension, bucket (prod), or account; a longer expiry; another signing time or key ID; a dropped signed header; a flipped signature; an extra parameter; or another secret. It works for 5 minutes, then expires. |
| Docs | 8 | The CORS policy in `docs/r2.md` allows exactly the live site and the laptop, PUT/GET/HEAD and only the `content-type` header, which is the only header the app's upload sends. |
| **Live** | 21 | **Dev bucket:** the PM storage check passes. Upload, size and type as stored, a byte-identical download that keeps a Chinese and emoji file name, and deletion. Refused: no link, a bigger file, another type, a tampered link, another key, an expired link, and the dev key on the prod bucket. A full upload through the app is opened by the homeowner, and a file that never arrived is refused. **CORS on both buckets:** the dev bucket allows the laptop and the live site; the prod bucket allows only the live site. Lookalike sites are refused. |

Production's own key can't be tested from the laptop, because it lives only in
Vercel. Once it's there, **Account → File storage → Check file storage** on the
live site confirms it with one request (see [r2.md](r2.md)).

---

## The whole flow: `tests_py/test_full_flow.py` (18 steps × 2 = 36)

One project goes from creation to closed, step by step, in the
order of [PROCESS_FLOW.md](PROCESS_FLOW.md). Every role plays its part
through the real API, and each step checks what must be refused as well as
what must work. It runs twice:
- **laptop:** files in `web/.uploads/`. Part of every `npm run test:py`.
- **r2:** files in the real R2 dev bucket, with `npm run test:r2`. It uploads
  15 files of about 70 bytes and the signed certificate, about 60 requests in
  all, and leaves the bucket empty.

| # | Step | Checked |
|---|---|---|
| 1 | PM creates the project from a postal code | Only a PM can. The address and the site's GPS come from the postal code. A start date alone gives an end date 3 weeks later. Status is *Awaiting homeowner*, and the homeowner is asked to approve. |
| 2 | Before approval | Nobody can fill in a field or get an upload link, not even the PM, so nothing reaches storage. Outsiders don't see the project. |
| 3 | Homeowner declines, PM asks again | The PM can't approve first. The decline reason reaches the PM. A reminder puts the project back to *Awaiting homeowner*. |
| 4 | Homeowner, then PM approve | The crew has nothing to approve. After the homeowner's approval it's still locked for the crew until the PM approves. Milestone 1 then opens; Milestone 2 doesn't. |
| 5 | Dates | Only the PM can change the end date, and the change is in the audit log under the PM's name. |
| 6 | Site visit scheduled | The contractor admin schedules today's visit and the EPC crew is told. The homeowner can't schedule. |
| 7 | EPC checks in and out | The admin can't check in. 1 km away is refused with the GPS message. 22 m away with a good fix works, and the visit shows *Attended*. Check-out with 3 crew works. A visit with a check-in can't be cancelled. |
| 8 | Before Milestone 1 | The homeowner can't upload. An HTML file is refused. The utility bill, GST proof, signed SP forms and MOC change are uploaded. The first upload starts the project (*In progress*). Retailer, IC and SP status are saved. |
| 9 | Survey, panels, inverter | Every detail is saved. Two panel photos (JPEG and PNG) and an inverter photo are uploaded. The homeowner sees both panel photos. |
| 10 | A photo removed by mistake | The homeowner can't remove it; the EPC can. The audit log names the EPC. A PM restores it with a reason, and it opens again byte for byte, because the stored copy is never deleted. |
| 11 | Milestone 1 complete | Not complete until the SP submission screenshot arrives. Then *Milestone 1 complete*, and the homeowner, PM and crew are told. |
| 12 | Milestone 1 locked | The crew can't change a field or add a photo. The crew can't reopen it; a PM can, and then the crew can edit again. |
| 13 | Milestone 2 | Milestone 3 uploads are refused until Milestone 2 is done. Commissioning, the breaker answer, the PVL date and the PVL letter complete it. |
| 14 | Milestone 3 and closing documents | Inspection dates, the appointment letter, the As Built PV Layout, the final submission and handover documents, and FusionSolar access. Not complete until the signed completion form arrives, then *Ready for handover*. |
| 15 | Awaiting E-Sign | All three milestones are recorded and no required field is empty. The homeowner's project list shows 100%, and only the homeowner is asked to sign. |
| 16 | Every file | All 15 files are on the project. The homeowner gets identical bytes back. Outsiders get no link to any of them. |
| 17 | The audit log | The PM, homeowner, admin and EPC each appear. All 15 uploads and the restore are recorded. The crew can't read the log. |
| 18 | The certificate | The homeowner reads it: 20 × 610 W, 12.20 kWp, the inverter serial and their name, with its fingerprint. The crew can no longer save a field or upload. Outsiders can't see it. |
| 19 | Signing | The PM and crew can't sign. A stale fingerprint and an unticked box are refused. The homeowner signs; the PM is alerted; signing twice is refused; the signature row records who and what. |
| 20 | The signed PDF | Opens for the homeowner, PM and crew, not outsiders. It carries the signature image, the signer and the fingerprint. |
| 21 | Closing | The homeowner and crew can't close; nothing can be reopened once signed. The PM closes; the homeowner and crew are told; closing twice is refused. |
| 22 | Storage | Storage holds exactly the project's 15 files and the signed certificate (PDF and signature), nothing extra and nothing missing. Afterwards it's empty. |

**Last run: 36 passed** (18 laptop, 18 R2). The dev bucket was empty afterwards.

---

## What the testing found

1. **Fixed: anyone could record a GPS check-in for anyone.** The location rules were enforced, but nothing checked *who* checked in: any signed-in account could record one for any person on any project, at any stage. The check-in screen doesn't exist yet, so this couldn't have been misused. It's now a database rule (migration 0020):
   - only the project's EPC crew can check in, and only as themselves
   - only while the project is approved or in progress
   - check-ins can't be deleted
   - only the person who checked in can check out
   - a PM can correct crew counts
2. **Two of my own cases were wrong, not the app.** They tried to "change" a recorded distance to the value it already had. Corrected, they pass.
3. **R2: nothing wrong in R2 or the app.** Three of my own R2 cases were wrong, and corrected they pass:
   - one expected "not allowed" where the app deliberately answers "not found", so outsiders aren't told a file exists
   - one built a malformed timestamp
   - one read the error from the wrong field
4. **The whole flow: nothing wrong in the app.** Two of my own expectations were wrong. The crew pressing Approve gets "nothing for you to approve" (and nothing changes), not "not allowed". And a test helper couldn't name a file of a disallowed type.
5. **Fixed: with R2 set up on the laptop, the existing upload tests would have broken.** They expected the local storage. Tests now use the local storage unless they're marked as R2 tests, so the suite never spends R2 requests. Tests that need the real bucket only run with `npm run test:r2`.
6. **Fixed: calendars didn't open from the calendar icon.** Every date and time field (Create/Edit Project, Schedule Visit, milestone dates) has a calendar icon that wasn't part of the input, so tapping it, the natural thing on a phone, did nothing. Tapping anywhere on the field now opens the phone's own date or time picker.
7. **Fixed: search gaps.**
   - The homeowner picker in Create Project only matched names; it now matches email and phone too.
   - The crew picker now matches roles ("epc").
   - The audit timeline's "sites" didn't find site check-ins (the page is called "Site visits").
   - The audit's by-person search ignored accents differently from everywhere else.

   All searches now share one set of rules.
8. **Fixed: `npm run test:py` didn't run on Windows** (the virtualenv path). npm scripts now start Python through `scripts/py.mjs`.
9. **Push encryption matches the standard's own worked example** (RFC 8291) byte for byte, and a separately written decryptor reads every message back.

## What these don't cover yet

- **Production's R2 key.** It lives only in Vercel, so it can't be tested from the laptop. The prod bucket and its CORS are checked without it. Once the key is in Vercel, **Account → File storage → Check file storage** on the live site confirms it with one request.
- **A phone's GPS in the browser.** The check-in screen exists now, but a laptop's location is too imprecise to pass. Test it on a phone at the site, or use the development-only "Use the site's location".
