# Solar monitoring (FusionSolar in the app)

Everything Huawei FusionSolar shows, in GetHomeApps, so nobody needs
FusionSolar itself: every plant's power now, yield today, this month, this
year and in total, revenue, status, alarms, charts by day, month, year and
lifetime, reports by hour, day and month (with specific yield, CO₂ and coal
saved) with Excel, and every device: each inverter's full live readings
(power, reactive power, power factor, efficiency, grid frequency,
temperature, each phase's voltage and current, each PV string's voltage,
current and power, each MPPT's energy, when it switched on and off today),
its model, serial number and software version, and the WiFi dongles.

Checked against the real account (22 Oct 2026: 91 plants, 101 inverters of
two kinds, 90 dongles). Most plants have no size on FusionSolar's plant
list; the app takes it from FusionSolar's daily figures, and otherwise from
the linked system. Grid feed-in and home use only show where a plant has a
meter (none do yet; FusionSolar reports 0 for them).

## Who sees what

| Who | Sees |
|---|---|
| Superadmin, Admin | Solar (under More on a phone): every plant |
| Project manager | The plants of the systems they run, systems nobody runs, and plants not linked yet; can link a plant to a system |
| Homeowner | My Solar: their own system's plant only, with its inverters' readings (no other homeowners, no serial numbers) |
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

## The charts

As FusionSolar draws them, and the screens update themselves every minute:

- **Power through the day** (kW every 5 minutes): on each plant's Overview, for
  all plants together on Solar, and for each inverter in its Details. The
  arrows go back a day at a time. 5-minute points are kept 400 days for a
  plant and 31 days for an inverter; older days are drawn from the hourly kWh
  (an hour's kWh is its average kW), kept with the plant. The import brings
  the last 31 days.
- **Yield** by hour, day, month, year and lifetime (columns): each plant's
  Energy tab, with revenue at its contract's rate, and all plants together
  on Solar.

## How the figures come in

`api/_lib/fusionsolar.py` talks to FusionSolar's Northbound API (it logs in
once and keeps the session for about 25 minutes); `api/_lib/solar_sync.py`
puts its answers into the app (migrations 0051 and 0052: `solar_plants`,
`solar_readings`, `solar_devices`, `solar_alarms`; an inverter's readings
are kept as FusionSolar names them, in `solar_devices.readings`). The 15-minute job runs it,
each kind at its own pace so FusionSolar's limits are kept:

| What | How often |
|---|---|
| Live figures, inverters' readings (both kinds: string, 1, and residential, 38), alarms | Every run (15 minutes) |
| Power every 5 minutes (each inverter's, so each plant's): the power curves | Every run (15 minutes) |
| Today by the hour | Every hour |
| This month by the day | Every 6 hours |
| This year by the month; the plant list; devices | Once a day |
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
