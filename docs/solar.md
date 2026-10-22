# Solar monitoring (FusionSolar in the app)

Everything Huawei FusionSolar shows, in GetHomeApps, so nobody needs
FusionSolar itself: every plant's power now, yield today, this month, this
year and in total, revenue, status, alarms, inverters, charts by day, month,
year and lifetime, and reports by hour, day and month with Excel.

## Who sees what

| Who | Sees |
|---|---|
| Superadmin, Admin | Solar (under More on a phone): every plant |
| Project manager | The plants of the systems they run, systems nobody runs, and plants not linked yet; can link a plant to a system |
| Homeowner | My Solar: their own system's plant only (no other homeowners, no serial numbers) |
| Crew, contractors | Nothing |

Revenue is the plant's yield at the rate in the system's contract (FusionSolar
has no tariff set). Environmental benefits use FusionSolar's own factors
(0.4 kg standard coal and 0.475 kg CO₂ per kWh; a tree per 18.3 kg CO₂), so the
figures match what people saw there.

## Connecting it (once)

1. FusionSolar → **System → Company Management → Northbound Management → Add**:
   - Username: e.g. `gethomeapps_api` (not anyone's own login)
   - Associated: the company account; Deadline: the latest date it allows
   - Companies/plants: tick **9 Solar Home Pte Ltd** (the company, not single
     plants) and press **»**, so every plant, and every future one, is included
   - APIs: **Basic APIs** on; anything that controls plants stays off
2. Settings (the laptop's `.env.local`, and Vercel → homesapp → Production,
   all Sensitive):
   - `FUSIONSOLAR_URL` — the start of FusionSolar's address, e.g. `https://sg5.fusionsolar.huawei.com`
   - `FUSIONSOLAR_USER`, `FUSIONSOLAR_PASSWORD` — the API account
3. Bring in the history (from the laptop; it waits whenever FusionSolar says
   it's being asked too often, and can be stopped and run again):

   ```bash
   node scripts/py.mjs scripts/solar_import.py --target dev
   node scripts/py.mjs scripts/solar_import.py --target prod --confirm
   ```

   It lists any plant it couldn't match to a system in the app by address;
   link those in Solar → the plant → **Link**.
4. Before the API account's deadline, extend it in FusionSolar.

## How the figures come in

`api/_lib/fusionsolar.py` talks to FusionSolar's Northbound API (it logs in
once and keeps the session for about 25 minutes); `api/_lib/solar_sync.py`
puts its answers into the app (migration 0051: `solar_plants`,
`solar_readings`, `solar_devices`, `solar_alarms`). The 15-minute job runs it,
each kind at its own pace so FusionSolar's limits are kept:

| What | How often |
|---|---|
| Live figures, inverters' power, alarms | Every run (15 minutes) |
| Today by the hour | Every hour |
| This month by the day | Every 6 hours |
| This year by the month; the plant list; inverters | Once a day |
| Every year | Once a week |
| Last month's kWh into the invoices' records (system_output) | Once a day |

A finished month's kWh goes into the linked system's monthly output, which
the monthly invoices are made from; written once, and again only if
FusionSolar's figure changes. A plant is linked to a system automatically
when its name or address matches exactly one system's address; otherwise a
project manager links it.

If FusionSolar is away or refuses, the rest of the 15-minute job carries on;
the screens say when the figures were last updated, and show "not live"
rather than zero for anything older than 45 minutes.

## Personal data

The plants' output is part of each system's records (kept and deleted with
them, docs/pdpa.md); a homeowner's Download my data includes it. Cleared
alarms go a year after they cleared.

## Tests

`tests_py/test_solar.py` (the sync, against a stand-in that answers as the
Northbound API does) and `tests_py/test_solar_api.py` (who sees what, the
charts, the report, linking).
