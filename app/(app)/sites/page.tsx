"use client";

import PlaceRoundedIcon from "@mui/icons-material/PlaceRounded";

import { ComingSoon } from "@/components/coming-soon";

/** Placeholder until GPS check-in is built. */
export default function SitesPage() {
  return (
    <ComingSoon
      title="Sites"
      sub="GPS check-in and check-out"
      icon={<PlaceRoundedIcon />}
      heading="Today's site visits will appear here"
      text="Check in on arrival with your crew count, and check out when you leave. Your phone's GPS confirms you're at the site. This screen is built in a later step."
    />
  );
}
