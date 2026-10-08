"use client";

import EngineeringRoundedIcon from "@mui/icons-material/EngineeringRounded";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import WorkOutlineRoundedIcon from "@mui/icons-material/WorkOutlineRounded";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { type ReactNode, useEffect, useState } from "react";

import type { Role } from "@/lib/client/app-state";
import { enterDemo } from "@/lib/client/demo";
import { T, TR } from "@/lib/client/i18n";

import { AuthChoices, AuthHeading, AuthSubtitle } from "./auth";

type Sample = { uid: number; name: string; role: Role; roleLabel: string; avatar: string | null; about: string | null };

const ICON: Record<Role, ReactNode> = {
  project_manager: <ShieldOutlinedIcon />,
  contractor: <WorkOutlineRoundedIcon />,
  epc_team: <EngineeringRoundedIcon />,
  homeowner: <HomeOutlinedIcon />,
};

/**
 * The demo site's sign-in: pick a sample person and see the app as them, no
 * password. Shown only on the demo deployment (lib/client/demo.ts).
 */
export function DemoPicker() {
  const [people, setPeople] = useState<Sample[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/py/demo/people", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { people: Sample[] }) => setPeople(d.people))
      .catch(() => setFailed(true));
  }, []);
  return (
    <Box data-testid="demo-picker">
      <AuthHeading>{T("Try the demo")}</AuthHeading>
      <AuthSubtitle>{T("Pick someone to see GetHomeApps as them. No password; it's all sample data, reset from time to time.")}</AuthSubtitle>
      {failed && <Typography sx={{ fontSize: 13, mb: 2 }}>{T("The demo isn't ready right now. Please try again later.")}</Typography>}
      {!people && !failed && (
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, mb: 2.75 }}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={64} />
          ))}
        </Box>
      )}
      {people && (
        <AuthChoices
          label="Sample people"
          value={null}
          onChange={(v) => {
            enterDemo(Number(v));
            // A full load, so every screen starts again as them.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = "/";
          }}
          options={people.map((p) => ({ value: String(p.uid), label: p.name, desc: p.about ? `${TR(p.roleLabel)} · ${p.about}` : TR(p.roleLabel), icon: ICON[p.role] }))}
        />
      )}
      <Divider sx={{ my: 2.5, fontSize: 12, color: "text.secondary", "&::before, &::after": { borderColor: "divider" } }}>{T("or sign in with your own account")}</Divider>
    </Box>
  );
}
