"use client";

import EventRoundedIcon from "@mui/icons-material/EventRounded";
import LoginRoundedIcon from "@mui/icons-material/LoginRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import PlaceRoundedIcon from "@mui/icons-material/PlaceRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import type { Theme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";

import { useProjectHref } from "@/components/projects";
import { Page } from "@/components/shell";
import { CheckDialog } from "@/components/site-visits";
import { EdgeCard, GRID, Heading, TopBar } from "@/components/topbar";
import { useApi } from "@/lib/client/api";
import { useMe } from "@/lib/client/app-state";
import { hhmm, type SiteRow, visitDay } from "@/lib/client/sites";

import { T } from "@/lib/client/i18n";
/**
 * The EPC team's day: where they're on site now (check out), where they're
 * due today, and every site they can check in at — any day of the week.
 */
export default function SitesPage() {
  const me = useMe();
  const href = useProjectHref();
  const { data, error, reload } = useApi<{ sites: SiteRow[]; canCheckIn: boolean }>(me ? "/sites" : null);
  const [target, setTarget] = useState<SiteRow | null>(null);
  if (!me) return null;

  const sites = data?.sites ?? [];
  const onSite = sites.filter((s) => s.open);
  const today = sites.filter((s) => !s.open && s.today.length);
  const rest = sites.filter((s) => !s.open && !s.today.length);

  const card = (s: SiteRow, tone: (t: Theme) => string) => (
    <EdgeCard key={s.id} color={tone}>
      <Box sx={{ p: 1.75, pl: 2.5, flex: 1 }} data-testid="site-card">
        <Stack direction="row" sx={{ gap: 1, alignItems: "flex-start" }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography component={Link} href={href(s.id)} noWrap sx={{ fontWeight: 600, fontSize: 16, color: "text.primary", textDecoration: "none", display: "block" }}>
              {s.name}
            </Typography>
            <Typography variant="body2" noWrap sx={{ color: "text.secondary", fontSize: 13 }}>
              {s.address}
            </Typography>
          </Box>
          {s.open ? <Chip size="small" color="success" label={T("On site")} /> : s.today.length ? <Chip size="small" color="warning" label={T("Due today")} /> : null}
        </Stack>
        <Stack sx={{ mt: 1.25, gap: 0.5 }}>
          {s.open && (
            <Typography variant="body2" sx={{ color: "primary.main", fontWeight: 600 }}>
              {T("Checked in {time} with {n} crew", { time: hhmm(s.open.inAt), n: s.open.crewIn })}
            </Typography>
          )}
          {s.today.map((v) => (
            <Stack key={v.id} direction="row" sx={{ gap: 0.75, alignItems: "center", color: "warning.main" }}>
              <EventRoundedIcon sx={{ fontSize: 16 }} />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {v.time ? T("Today at {time}", { time: v.time }) : T("Today")}
                {v.note ? ` · ${v.note}` : ""}
              </Typography>
            </Stack>
          ))}
          {!s.today.length && s.next && (
            <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", color: "text.secondary" }}>
              <EventRoundedIcon sx={{ fontSize: 16 }} />
              <Typography variant="body2">
                {T("Next visit {day}", { day: visitDay(s.next.date) })}
                {s.next.time ? ` at ${s.next.time}` : ""}
                {s.next.note ? ` · ${s.next.note}` : ""}
              </Typography>
            </Stack>
          )}
          {!s.located && (
            <Typography variant="caption" sx={{ color: "warning.main" }}>
              {T("No GPS location for this site yet, so check-in is off.")}
            </Typography>
          )}
        </Stack>
        {data?.canCheckIn && (
          <Button
            fullWidth
            size="large"
            variant={s.open || s.today.length ? "contained" : "outlined"}
            color={s.open ? "warning" : "primary"}
            disabled={!s.canCheckIn}
            startIcon={s.open ? <LogoutRoundedIcon /> : <LoginRoundedIcon />}
            onClick={() => setTarget(s)}
            sx={{ mt: 1.75 }}
          >
            {s.open ? T("Check Out") : T("Check In")}
          </Button>
        )}
      </Box>
    </EdgeCard>
  );

  return (
    <>
      <TopBar title={T("Sites")} sub={T("GPS check-in and check-out")} />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {!data && !error && (
            <Box sx={{ ...GRID, mt: 3 }}>
              {Array.from({ length: 2 }, (_, i) => (
                <Skeleton key={i} variant="rounded" height={170} />
              ))}
            </Box>
          )}
          {data && sites.length === 0 && (
            <Card sx={{ p: 4, mt: 2, textAlign: "center" }} data-testid="sites-empty">
              <PlaceRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
              <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("No sites to check in at yet")}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                {T("Projects appear here once they're approved and your contractor group is on them.")}
              </Typography>
            </Card>
          )}
          {onSite.length > 0 && (
            <>
              <Heading title={T("On site now")} count={onSite.length} />
              <Box sx={GRID}>{onSite.map((s) => card(s, (t) => t.palette.success.main))}</Box>
            </>
          )}
          {today.length > 0 && (
            <>
              <Heading title={T("Due today")} count={today.length} />
              <Box sx={GRID}>{today.map((s) => card(s, (t) => t.palette.warning.main))}</Box>
            </>
          )}
          {rest.length > 0 && (
            <>
              <Heading title={onSite.length || today.length ? T("Your other sites") : T("Your sites")} count={rest.length} />
              <Box sx={GRID}>{rest.map((s) => card(s, (t) => t.palette.primary.main))}</Box>
            </>
          )}
          {data && sites.length > 0 && (
            <Typography variant="caption" component="p" sx={{ textAlign: "center", color: "text.secondary", mt: 3 }}>
              {T("Check in on arrival and out when you leave, at the house with a good GPS signal. You can check in any day, not just scheduled ones.")}
            </Typography>
          )}
        </Page>
      </Box>
      {target && (
        <CheckDialog
          target={{ projectId: target.id, name: target.name, address: target.address, open: target.open, site: target.site }}
          onClose={() => setTarget(null)}
          onDone={reload}
        />
      )}
    </>
  );
}
