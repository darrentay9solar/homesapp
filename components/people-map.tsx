"use client";

import LocationOffRoundedIcon from "@mui/icons-material/LocationOffRounded";
import MyLocationRoundedIcon from "@mui/icons-material/MyLocationRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { useTheme as useMuiTheme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";

import { RoleAvatar, SettingRow } from "@/components/m";
import { MapView, type Pin } from "@/components/map";
import { GRID, roleColor } from "@/components/topbar";
import { initials } from "@/components/ui";
import { useApi } from "@/lib/client/api";
import type { Role } from "@/lib/client/app-state";
import { T, TR } from "@/lib/client/i18n";
import { seenAgo } from "@/lib/client/location";

export type CrewFix = {
  uid: number;
  name: string;
  role: Role;
  roleLabel: string;
  avatar: string | null;
  /** Their latest check-in or check-out: the phone's GPS when they pressed the button. */
  location: { lat: number; lng: number; accuracy: number | null; at: string; kind: "in" | "out"; projectId: number; project: string } | null;
};
type Data = { people: CrewFix[] };

/** "Checked in at Jalan Kayu · 5 min ago". */
function fixText(f: NonNullable<CrewFix["location"]>): string {
  const when = seenAgo(f.at).text;
  return f.kind === "in" ? T("Checked in at {project} · {when}", { project: f.project, when }) : T("Checked out of {project} · {when}", { project: f.project, when });
}

/**
 * People → Map (project managers and superadmins): where each EPC crew member
 * last checked in or out. A location is only ever taken when they press the
 * button, so this is never live tracking. Project managers see check-ins on
 * the projects they run; a superadmin sees every one.
 */
export function PeopleMap({ onOpen }: { onOpen: (uid: number) => void }) {
  const { data, error, reload } = useApi<Data>("/people/locations");
  const [picked, setPicked] = useState<number | null>(null);
  const theme = useMuiTheme();

  const people = useMemo(() => data?.people ?? [], [data]);
  const located = people.filter((p) => p.location);
  const pins: Pin[] = useMemo(
    () =>
      located.map((p) => ({
        id: String(p.uid),
        lat: p.location!.lat,
        lng: p.location!.lng,
        kind: "person",
        label: p.name,
        initials: initials(p.name),
        color: roleColor(p.role)(theme),
        avatar: p.avatar,
        dim: seenAgo(p.location!.at).stale,
      })),
    [located, theme]
  );

  if (error) return <Alert severity="error" sx={{ mt: 2 }}>{error.message}</Alert>;
  if (!data) return <Skeleton variant="rounded" height={360} sx={{ mt: 2 }} />;

  return (
    <Box sx={{ mt: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 1.5 }}>
        <Typography variant="body2" sx={{ color: "text.secondary", flex: 1 }}>
          {T("Where the EPC crew last checked in or out. Taken only when they press the button.")}
        </Typography>
        <Button size="small" startIcon={<RefreshRoundedIcon />} onClick={() => void reload()} sx={{ flex: "0 0 auto" }}>
          {T("Refresh")}
        </Button>
      </Stack>
      <MapView pins={pins} picked={picked ? String(picked) : null} onPick={(id) => setPicked(Number(id))} height={{ xs: 340, lg: 460 }} testId="people-map" />
      {located.length === 0 && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          {T("No check-ins yet. Each EPC crew member appears here once they check in at a site.")}
        </Alert>
      )}
      <Box sx={{ ...GRID, mt: 2 }} data-testid="people-locations">
        {people.map((p) => {
          const seen = p.location ? seenAgo(p.location.at) : null;
          return (
            <Card key={p.uid} sx={{ display: "flex", borderColor: picked === p.uid ? "primary.main" : "divider" }} data-testid="location-card">
              <CardActionArea
                onClick={() => (p.location ? setPicked(p.uid) : onOpen(p.uid))}
                sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1.5, justifyContent: "flex-start" }}
              >
                <RoleAvatar name={p.name} role={p.role} src={p.avatar} size={40} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontWeight: 600 }}>
                    {p.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
                    {p.location ? fixText(p.location) : `${TR(p.roleLabel)} · ${T("No check-ins yet")}`}
                  </Typography>
                </Box>
                {seen && (
                  <Chip
                    size="small"
                    icon={<MyLocationRoundedIcon />}
                    label={p.location!.kind === "in" ? T("On site") : T("Left")}
                    color={p.location!.kind === "in" && !seen.stale ? "success" : "default"}
                    variant="outlined"
                  />
                )}
              </CardActionArea>
            </Card>
          );
        })}
      </Box>
    </Box>
  );
}

/** In an EPC crew member's Profile (People): where they last checked in or out, on a small map. */
export function LocationRow({ uid }: { uid: number }) {
  const { data } = useApi<Data>("/people/locations");
  const p = data?.people.find((x) => x.uid === uid);
  const pins: Pin[] = p?.location ? [{ id: String(uid), lat: p.location.lat, lng: p.location.lng, kind: "person", label: p.name, initials: initials(p.name), avatar: p.avatar }] : [];
  return (
    <SettingRow
      icon={p?.location ? <MyLocationRoundedIcon /> : <LocationOffRoundedIcon />}
      tint="#2563EB"
      label={T("Last check-in location")}
      sub={!data ? "…" : p?.location ? fixText(p.location) + (p.location.accuracy ? ` · ±${Math.round(p.location.accuracy)} m` : "") : T("No check-ins yet")}
    >
      {pins.length > 0 && <MapView pins={pins} picked={String(uid)} height={180} testId="person-map" />}
    </SettingRow>
  );
}
