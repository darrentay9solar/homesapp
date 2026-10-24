# SP Power: electricity prices

The **SP Power** page (Info → SP Power) shows what electricity costs to buy from SP Group and what SP
pays for solar sent to the grid. Everyone signed in sees it; a homeowner also sees their own solar beside it.

## Where the figures come from

- **This quarter:** SP Group's tariff page
  (<https://www.spgroup.com.sg/our-services/utilities/tariff-information>). SP sets the household tariff
  each quarter and shows it there with its parts: energy costs, network costs, the market support services
  fee, and the market admin and power system operation fee. There's no feed to read, so the app reads the
  page twice a day (`api/_lib/tariff.py`, from the scheduled job) and keeps each quarter in `sp_tariffs`
  (migration 0059). The parts are kept only when they add up to the total; if SP changes its page so the
  tariff can't be found, the read fails loudly and the last quarter stays.
- **Earlier months:** SP Group's own monthly series on data.gov.sg ("Low Tension Supplies - Domestic",
  before GST), read weekly. It has the totals only, not the parts.
- **July to September 2026:** from SP's announcement for that quarter (up 4.64 cents on the quarter before:
  31.91 cents before GST). Its parts were published only as an image, so they're not kept.

## What the page works out

- **Buying from SP:** the tariff with GST (7% to 2022, 8% in 2023, 9% from 2024).
- **Selling to SP:** the tariff before GST less the network costs: what SP credits for solar sent to the grid
  under EMA's simplified credit treatment (the network costs pay for SP's own grid). Known from the quarters
  whose parts are kept.
- **The last 12 months:** the average of each, over the months known.
- **Your solar beside SP** (homeowners): their contract's rate per kWh, this month's yield, and what that
  yield would have cost at SP's tariff less what it costs from 9 Solar Home.
