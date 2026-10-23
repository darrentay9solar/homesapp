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

## Records imported from the lists

Systems from 9 Solar Home's project listing and client list never went through the app. Each gets a
**record project** (migration 0058, `client_list.record_projects`): a handed-over project holding the
project's part of the flow, from before Milestone 1 to the handover, filled with what the lists say.
Inverter collected, grid connection and the SP application follow from the system being turned on; its
handover date is the turn-on date; it needs no admin-fee invoice and has no signed certificate. It's
reached like any handed-over project: Maintenance → the system → *Project history* → *Open the project*.

Every required field still empty on an imported record (`api/_lib/to_fill.py`) is flagged for its
project manager:

- on the project, a *Fields to fill* notice, each empty field marked *To fill*, and each section's count;
  every section is open, in any order, though it's handed over (the crew can't change a record);
- on the system, its own empty fields (postal code, homeowner, contact number, panels, size, phase,
  inverters, turn-on date, PPA, plan, roof access) and how many are empty on its project record;
- in the lists, a *Fields to fill* count on the system's card, and *Needs attention* on the project.

When a superadmin hands an imported system to a project manager, or a manager takes on an imported
project, that manager is alerted to what's still to fill. Homeowners see none of this.

**Installed photos** come in through Projects → *Import from Excel* → *Import installed photos instead*
(superadmins): the zip or the folder of `9SHnnnn-address` folders. Each folder goes to the project with
that code (a system's record project first), only if the address agrees; a photo whose name or subfolder
says inverter goes into *Installed Inverter Pictures*, the rest into *Installed Panel Pictures*; one
already there isn't uploaded twice (`api/_lib/photo_import.py`).
