"use client";

import EventRoundedIcon from "@mui/icons-material/EventRounded";
import HandymanRoundedIcon from "@mui/icons-material/HandymanRounded";
import PersonOffRoundedIcon from "@mui/icons-material/PersonOffRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { StatTile, TILE_GRID } from "@/components/charts";
import { Page } from "@/components/shell";
import { SystemCard } from "@/components/maintenance";
import { GRID, Heading, SearchBox, SegTabs, TopBar } from "@/components/topbar";
import { kwp as kwpFigure, num } from "@/lib/client/analytics";
import { useApi } from "@/lib/client/api";
import { isAdmin, useMe } from "@/lib/client/app-state";
import { T } from "@/lib/client/i18n";
import { filterSystems, inMTab, type MaintenanceList, MTABS, type MTab, sortSystems } from "@/lib/client/maintenance";

/**
 * Maintenance, for project managers and superadmins: every system 9 Solar
 * Home looks after once it's turned on. Handed-over projects arrive here by
 * themselves; systems from before the app were imported from the project
 * listing and are assigned to a manager later. What needs a visit (urgent,
 * a check overdue) is red and first.
 */
export default function MaintenancePage() {
  const me = useMe();
  const router = useRouter();
  const admin = isAdmin(me?.role);
  useEffect(() => {
    if (me && !admin) router.replace("/");
  }, [me, admin, router]);
  const { data, error } = useApi<MaintenanceList>(admin ? "/maintenance" : null);
  const [tab, setTab] = useState<MTab>("all");
  const [q, setQ] = useState("");
  const all = useMemo(() => sortSystems(data?.systems ?? []), [data]);
  if (!me || !admin) return null;

  const shown = filterSystems(all, { query: q, tab });
  const count = (t: MTab) => all.filter((s) => inMTab(s, t)).length;
  const capacity = all.reduce((a, s) => a + (s.kwp ?? 0), 0);
  const pick = (t: MTab) => setTab((x) => (x === t ? "all" : t));
  return (
    <>
      <TopBar
        title={T("Maintenance")}
        search={<SearchBox value={q} onChange={setQ} placeholder={T("Search addresses, inverters, homeowners")} testId="maintenance-search" />}
        tabs={<SegTabs label={T("Filter systems")} value={tab} onChange={setTab} options={MTABS.map(([v, l]) => ({ value: v, label: l, count: data ? count(v) : undefined }))} />}
      />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {!data && !error && (
            <Box sx={{ ...GRID, mt: 3 }}>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} variant="rounded" height={190} />
              ))}
            </Box>
          )}
          {data && (
            <>
              <Box sx={{ ...TILE_GRID, mt: 1.5, mb: 1 }}>
                <StatTile label="Systems looked after" value={num(all.length)} icon={<SolarPowerRoundedIcon />} sub={kwpFigure(capacity)} />
                <StatTile label="Need attention" value={num(count("attention"))} icon={<WarningAmberRoundedIcon />} tone={count("attention") ? "bad" : "good"} sub={T("Urgent, or a check overdue")} open={tab === "attention"} onClick={() => pick("attention")} testId="mtile-attention" />
                <StatTile label="Checks due in 30 days" value={num(count("due"))} icon={<EventRoundedIcon />} tone={count("due") ? "warn" : undefined} sub={T("6-month and 1-year checks")} open={tab === "due"} onClick={() => pick("due")} testId="mtile-due" />
                <StatTile label="Unassigned" value={num(count("unassigned"))} icon={<PersonOffRoundedIcon />} sub={data.canAssign ? T("Give each one a project manager") : T("A superadmin assigns them")} open={tab === "unassigned"} onClick={() => pick("unassigned")} testId="mtile-unassigned" />
              </Box>
              <Heading title={tab === "all" ? T("Systems") : (MTABS.find(([v]) => v === tab)?.[1] ?? T("Systems"))} count={shown.length} />
              {shown.length === 0 ? (
                <Card sx={{ p: 4, textAlign: "center" }} data-testid="maintenance-empty">
                  {all.length === 0 ? (
                    <>
                      <HandymanRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
                      <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("No systems to look after yet")}</Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                        {T("A project comes here once it's signed off and handed over.")}
                      </Typography>
                    </>
                  ) : (
                    <>
                      <SearchRoundedIcon sx={{ fontSize: 36, color: "text.disabled" }} />
                      <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("Nothing matches")}</Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                        {T("Try an address, postal code, inverter model, or words like “urgent” or “overdue”.")}
                      </Typography>
                    </>
                  )}
                </Card>
              ) : (
                <Box sx={GRID} data-testid="maintenance-grid">
                  {shown.map((s) => (
                    <SystemCard key={s.id} s={s} />
                  ))}
                </Box>
              )}
            </>
          )}
        </Page>
      </Box>
    </>
  );
}
