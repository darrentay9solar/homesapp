# KPIs: the business in figures

The **KPIs** page (Info → KPIs; superadmins and Admin) works out each figure
from the app's own records and shows the calculation beside it, with the
numbers put in. The API is `GET /api/py/kpis` (`api/_routes/kpis.py`); its
tests are `tests_py/test_kpis.py` and `tests_py/uat/test_uat_kpis.py`.

Everything is totals: no homeowner's name, address or own figures. "Last
month" is the last finished calendar month.

## Portfolio

| Figure | How it's worked out |
|---|---|
| Systems running | Every system's client record (`maintenance_systems`) |
| Installed kWp | The systems' kWp added up |
| Installs in progress | Projects from *awaiting homeowner* to *signed* |
| Turned on in 12 months | Systems whose turn-on date is in the last 12 months |

## Revenue

| Figure | How it's worked out |
|---|---|
| Monthly revenue | For each system: last month's kWh (`system_output`) × its rate, to the cent (half a cent up), added up. No rate: not counted. |
| Yearly run-rate | Last month × 12; and the last three months' average × 12 |
| Still to come from the contracts | For each PPA system with a rate and a turn-on date: months left in its own term (`ppa_years`, else the invoice settings' years) × its usual month's kWh × its rate. Usual month = its average over the last 12 months when it has 3 or more, else the client record's `est_monthly_kwh`. Not discounted; no allowance for panels ageing or weather. |
| Admin fees to come | Installs in progress × the admin fee in the invoice settings |
| Collected | Paid ÷ invoiced, over every invoice not voided |
| Outstanding, overdue | Issued and unpaid; overdue = past its due date |

## Generation

| Figure | How it's worked out |
|---|---|
| Generated since turned on | FusionSolar's lifetime yield for every plant, added up |
| Last month, 12 months | Each system's invoiced kWh (the client list to Aug 2026, FusionSolar from Sep) |
| kWh per kWp a day | Last month's kWh ÷ kWp ÷ days, for systems with both (about 3.2 to 3.6 is usual in Singapore) |
| Beside the estimate | Last month's kWh ÷ the client records' estimate, for systems with both |

## Customers

| Figure | How it's worked out |
|---|---|
| What customers pay per kWh | Last month's revenue ÷ its kWh (each rate weighted by its kWh) |
| Cheaper than SP | (SP's current tariff with GST − that) ÷ SP's tariff |
| Customers saved in 12 months | For each system and month: kWh × (SP's tariff that month with GST − its rate) |
| CO2 avoided, trees | Lifetime kWh × 0.475 kg ÷ 1,000; trees = CO2 ÷ 18.3 kg (FusionSolar's factors) |

## Operations

Plant health (FusionSolar's), active alarms by level, systems linked to a
FusionSolar plant, and when the live figures were last fetched.

## Checks

What makes a figure less certain, with the systems' project codes: a contract
term other than the one invoicing uses, no rate, not a PPA, billed on its own
dates rather than calendar months, systems not on FusionSolar, plants not
linked to a system, months where the invoiced kWh isn't FusionSolar's, no
size, no estimate.
