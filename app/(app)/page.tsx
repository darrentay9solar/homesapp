"use client";

import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";

import { SectionTitle } from "@/components/m";
import { Header, Page } from "@/components/shell";
import { useMe } from "@/lib/client/app-state";

/**
 * Home. Homeowners get "My Project"; everyone else the project list.
 * (Filled in by the Projects function.)
 */
export default function Home() {
  const me = useMe();
  if (!me) return null;
  const homeowner = me.role === "homeowner";
  return (
    <>
      <Header
        title={homeowner ? "My Project" : me.role === "project_manager" ? "All Projects" : "Assigned Projects"}
        sub={homeowner ? me.fullName : `${me.roleLabel} · ${me.fullName ?? me.email}`}
      />
      <Page>
        <SectionTitle title="Projects" count={0} />
        <Card sx={{ p: 5, textAlign: "center" }}>
          <SolarPowerRoundedIcon sx={{ fontSize: 44, color: "primary.main" }} />
          <Typography sx={{ fontWeight: 600, mt: 1 }}>
            {homeowner ? "No project is linked to your account yet" : "No projects yet"}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
            Projects arrive with the next build step.
          </Typography>
        </Card>
      </Page>
    </>
  );
}
