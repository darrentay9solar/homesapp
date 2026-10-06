# Upload and GPS test cases

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

## What the testing found

1. **Fixed: anyone could record a GPS check-in for anyone.** The location rules were enforced, but nothing checked *who* checked in: any signed-in account could record one for any person on any project, at any stage. The check-in screen doesn't exist yet, so this couldn't have been misused. It's now a database rule (migration 0020):
   - only the project's EPC crew can check in, and only as themselves
   - only while the project is approved or in progress
   - check-ins can't be deleted
   - only the person who checked in can check out
   - a PM can correct crew counts
2. **Two of my own cases were wrong, not the app.** They tried to "change" a recorded distance to the value it already had. Corrected, they pass.

## What these don't cover yet

- **Real Cloudflare R2.** The signing is proven against Amazon's own example, but R2 isn't set up yet, so actual uploads were tested against the local storage on your computer. They use the same flow and checks; only where the bytes land differs. Once R2 is configured, one real upload confirms the connection.
- **A phone's GPS in the browser.** The check-in screen is the next build step. These cases test the rules it will rely on, which is where the real enforcement is.
