# GetApps: the project workflow, groups and Works checklists

GetApps (9 Solar Fintech, `EDITION=fintech`; see [editions.md](editions.md)) runs its projects
on its own workflow, for business clients such as factories. 9 Solar Home's app doesn't use any
of this: its routes answer 404 there, and migration 0061 isn't applied to its database.

One definition, `api/_lib/workflow.py`, drives the project page, the projects list, the groups
and the API's checks, so they always agree.

## The workflow

| # | Stage | Items | Also |
|---|---|---|---|
| 1 | Pre-Installation | IFC PV Layout, PV System, Single Line Diagram, Structure Drawing | |
| 2 | Mechanical Installation | Solar Panels; *with applicable PE/LEW endorsements:* As-Built PVL, Applicable Railings | Mechanical Works checklist |
| 3 | Electrical Installation | PVDB, Isolators, Inverters (one picture, with their serial number and size), Electrical MSB Modules; *with applicable PE/LEW endorsements:* As-Built PVSL, As-Built Single Line Diagram | Electrical Works checklist |
| 4 | Commissioning | Pre-Commissioning Report, SCDF Final Acceptance | |
| 5 | SP Turn-On | SP Turn-On, QA/QC Checklist | Opens when stages 1–4 **and** the SP milestones are done |

**SP milestones**, alongside the installation:

| Item | Opens |
|---|---|
| CS1 Application | when Pre-Installation is complete |
| PV1 Letter | after CS1 |
| PQ Submission | when Electrical Installation is complete |
| PV2 Letter | after PQ |
| Connection Agreement | after PV2; due a week after the PV2 letter, flagged when overdue |

- An item is done when its drawing is uploaded (photo or PDF) and it's ticked. A stage opens
  when the one before it is complete; nothing in it can be done before.
- An item can be unticked (its drawings then change) only while nothing that depends on it is
  done.
- When SP Turn-On's two items are done, the project is **complete** and moves to the list's
  Completed tab.
- **Timeline:** a project runs 10 months from its start (`target_end`). Past that and not
  complete, it's late, and flagged.
- Progress is the share of every item, checklist tick and SP milestone that's done.
- Who: the project's HQ Staff manager (or a superadmin) and its crew (EPC Project Manager,
  contractor) upload and tick. Everyone else on the project sees it.

## Groups and phases

A group is a contract: a name, contract reference, client and notes, with as many phases as it
needs. A project can be put in a group and one of its phases when it's created, or later in
its Edit. Removing a phase leaves its projects in the group; a group can be removed once it
has no projects. The office (superadmin, HQ Staff) manages groups and phases.

The **Groups** page shows the figures across the groups shown: projects, completed, late,
average progress, projects at each stage, and how many have each SP milestone. It filters by
words, stage and late projects. A group's page shows the same for its projects, with a filter
for each column: phase, stage, an SP milestone done or not, timing, and words.

## Works checklists

**Groups → Works checklists**: the office uploads the Mechanical and Electrical Works
checklists as Excel (.xlsx). The first sheet's first column is read top to bottom, one item per
row; a heading row (Item, Description, No., S/N…) and pure numbers are left out. Uploading a new
sheet replaces the list; an item with the same wording keeps the ticks already made on projects.
Until a checklist is uploaded, its stage can be completed without it.

## Where it lives

| Part | File |
|---|---|
| The workflow's definition and state | `api/_lib/workflow.py` |
| API: workflow, uploads, ticks, checklists, groups, phases | `api/_routes/workflow.py` |
| Projects list and page (stage, progress, flags, group) | `api/_routes/projects.py` (fintech only) |
| Database | `db/migrations/0061_getapps_workflow.sql`: `project_steps`, `workflow_checklist_items`, `project_groups`, `project_phases`, `projects.group_id/phase_id`, `project_files.step` |
| Screens | `components/workflow.tsx`, `components/groups.tsx`, `app/(app)/groups` |
| Tests | `tests_py/test_getapps_workflow.py`, `tests/workflow.test.ts` |
