"use client";

import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";

import { ComingSoon } from "@/components/coming-soon";

/** Placeholder until the Alerts function is built. */
export default function AlertsPage() {
  return (
    <ComingSoon
      title="Alerts"
      sub="Approvals, site visits and handover"
      icon={<NotificationsRoundedIcon />}
      heading="Your alerts will appear here"
      text="Approval requests, site visit reminders, missed check-ins and handover notices. This screen is built in a later step."
    />
  );
}
