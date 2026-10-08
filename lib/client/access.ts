/** What each role may do in GetHomeApps, in points (Account → Access). Keys are English; the screen translates them. */

import type { Role } from "./app-state";

/** What each role may do, in points; `no` is what it may not. */
export const ACCESS: Record<Role, { yes: string[]; no: string[] }> = {
  homeowner: {
    yes: [
      "See your own project: its progress, milestones and checklist",
      "Approve or decline your project when 9 Solar Home asks",
      "E-sign the handover certificate when the work is done",
      "Get alerts about your installation on your phone",
    ],
    no: ["See other people's projects or change project fields"],
  },
  contractor: {
    yes: [
      "See the projects your contractor groups are on",
      "Fill in and edit every milestone field on those projects",
      "Upload photos and documents, and see everything you've uploaded",
      "Schedule and cancel EPC site visits",
      "See your sites on the map",
    ],
    no: ["Create projects or change project details", "Check in at sites (that's the EPC team)"],
  },
  epc_team: {
    yes: [
      "Everything a contractor admin can do on your groups' projects",
      "Check in and out at sites with your phone's GPS, with crew counts",
      "Get a reminder an hour before each site visit",
    ],
    no: ["Create projects or change project details"],
  },
  project_manager: {
    yes: [
      "Create, edit and close projects, and override any field",
      "Approve projects, new accounts and role changes",
      "Manage people: roles, groups, pictures, expiry dates and disabling",
      "Schedule EPC visits and see every check-in",
      "See everyone's files, and where people sharing their location are",
      "Revert or restore any change in the audit log",
      "Check that file storage is online",
    ],
    no: [],
  },
};
