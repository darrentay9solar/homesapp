# Upload, R2 storage and GPS test cases

1,081 automated cases: 450 for uploading pictures and documents, and 631 for
GPS location. Each case is one pytest test, run against the real API and the
real database rules on the Neon **test** branch. Nothing touches dev or
production.

```bash
.venv/Scripts/python.exe -m pytest -q tests_py/test_upload_cases.py tests_py/test_gps_cases.py
```

**Last run: 1,081 passed** (with the rest of the suite: 1,176 passed).

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
**Live** group contacts Cloudflare: about 30 requests with tiny files, all
deleted afterwards. That's nothing against the free 1 million writes and
10 million reads a month. Every other case checks the links the app signs
with an independent signature check, the same way R2 checks them, without
sending anything. The rest of the suite never touches R2: in tests, uploads
go to `web/.uploads/`.

```bash
.venv/Scripts/python.exe -m pytest -q tests_py/test_r2_setup.py              # all 1,470
.venv/Scripts/python.exe -m pytest -q tests_py/test_r2_setup.py -m "not r2_live"  # without contacting R2
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
4. **Fixed: with R2 set up on the laptop, the existing upload tests would have broken.** They expected the local storage. Tests now use the local storage unless they're marked as R2 tests, so the suite never spends R2 requests.

## What these don't cover yet

- **Production's R2 key.** It lives only in Vercel, so it can't be tested from the laptop. The prod bucket and its CORS are checked without it. Once the key is in Vercel, **Account → File storage → Check file storage** on the live site confirms it with one request.
- **A phone's GPS in the browser.** The check-in screen exists now, but a laptop's location is too imprecise to pass. Test it on a phone at the site, or use the development-only "Use the site's location".
