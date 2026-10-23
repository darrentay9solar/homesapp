# Maintenance

How a system's maintenance runs once its project is handed over.

## Who sees what

| Who | Sees |
|---|---|
| Project manager (their systems), superadmin | Every check with its date: the **6-month check** (a record), then the **yearly checks** from 24 months after turn-on for the plan's years; reminders before, on and after each yearly check's date; the maintenance under way |
| Homeowner | **No schedule and no dates.** Only maintenance their project manager has started, its visit, and when it was last done |

## The checks

- **6-month check**: a record for the office only. Its date is the client list's, or six months after
  turn-on. Record it as done; it never makes a system late, sends no reminders, and has no workflow.
- **Yearly checks**: none in the first year; then one a year, the first 24 months after turn-on, the
  last in the plan's final year (the PPA's years when there's no plan). Reminders go to the project
  manager (superadmins when nobody runs the system): 14 days before, on the day, and once when overdue.

## The workflow

1. **Start maintenance** (Maintenance → the system → a check → *Start maintenance*, or *Start other
   maintenance* for work not tied to a check). The homeowner gets a message that maintenance is
   starting and that their project manager will arrange a visit. It doesn't say which check.
2. **Book the visit** (*Book a visit* on that check). The homeowner is invited, and accepts it or blocks
   out times in their calendar. Booking a check's visit starts its maintenance if nobody has yet.
3. **Done** (or *Mark done* on the check): the check is recorded as done and the homeowner hears it's
   finished. **Call off**: the check stays open and the homeowner hears it won't go ahead for now.

One piece of maintenance is open on a system at a time. Each one stays on the record (migration
0057, `maintenance_jobs`): started, by whom, finished or called off, and when.
