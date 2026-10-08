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
import { useEffect, useMemo, useState } from "react";

import { RoleAvatar, SettingRow } from "@/components/m";
import { MapView, type Pin } from "@/components/map";
import { GRID, roleColor } from "@/components/topbar";
import { initials } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { type Role, useApp } from "@/lib/client/app-state";
import { T, TR } from "@/lib/client/i18n";
import { seenAgo } from "@/lib/client/location";

export type LocPerson = {
  uid: number;
  name: string;
  role: Role;
  roleLabel: string;
  avatar: string | null;
  sharing: boolean;
  location: { lat: number; lng: number; accuracy: number | null; at: string } | null;
};
type Data = { me: number; people: LocPerson[] };

function useAsk() {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [busy, setBusy] = useState<number | null>(null);
  const ask = async (uid: number) => {
    setBusy(uid);
    try {
      const r = await fetcher<{ message: string }>(`/people/${uid}/ask-location`, { method: "POST" });
      toast(r.message);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : T("Something went wrong."), "bad");
    } finally {
      setBusy(null);
    }
  };
  return { ask, busy };
}

/**
 * People → Map (project managers): where everyone who shares their location
 * was last seen, and everyone who doesn't, with a button to ask them. Sharing
 * is each person's own choice; positions refresh every minute while open.
 */
export function PeopleMap({ onOpen }: { onOpen: (uid: number) => void }) {
  const { data, error, reload } = useApi<Data>("/people/locations");
  const [picked, setPicked] = useState<number | null>(null);
  const theme = useMuiTheme();
  const { ask, busy } = useAsk();

  useEffect(() => {
    const t = window.setInterval(() => void reload(), 60_000);
    return () => window.clearInterval(t);
  }, [reload]);

  const people = useMemo(() => (data?.people ?? []).filter((p) => p.uid !== data?.me), [data]);
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
          {T("{n} of {total} sharing their location", { n: people.filter((p) => p.sharing).length, total: people.length })}
        </Typography>
        <Button size="small" startIcon={<RefreshRoundedIcon />} onClick={() => void reload()}>
          {T("Refresh")}
        </Button>
      </Stack>
      <MapView pins={pins} picked={picked ? String(picked) : null} onPick={(id) => setPicked(Number(id))} height={{ xs: 340, lg: 460 }} testId="people-map" />
      {located.length === 0 && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          {T("Nobody is sharing their location right now. Ask someone below; they choose whether to turn it on.")}
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
                    {TR(p.roleLabel)}
                    {" · "}
                    {seen ? T("Seen {when}", { when: seen.text }) : p.sharing ? T("Sharing, no position yet") : T("Not sharing")}
                  </Typography>
                </Box>
                {seen && <Chip size="small" icon={<MyLocationRoundedIcon />} label={seen.stale ? T("Old") : T("Live")} color={seen.stale ? "default" : "success"} variant="outlined" />}
              </CardActionArea>
              {!p.sharing && (
                <Box sx={{ display: "flex", alignItems: "center", pr: 1.5 }}>
                  <Button size="small" variant="outlined" disabled={busy === p.uid} onClick={() => void ask(p.uid)} data-testid="ask-location">
                    {T("Ask")}
                  </Button>
                </Box>
              )}
            </Card>
          );
        })}
      </Box>
    </Box>
  );
}

/** In a person's Profile (People): where they were last seen, or a button to ask them to share. */
export function LocationRow({ uid, isMe }: { uid: number; isMe: boolean }) {
  const { data } = useApi<Data>("/people/locations");
  const { ask, busy } = useAsk();
  const p = data?.people.find((x) => x.uid === uid);
  const seen = p?.location ? seenAgo(p.location.at) : null;
  const pins: Pin[] = p?.location ? [{ id: String(uid), lat: p.location.lat, lng: p.location.lng, kind: "person", label: p.name, initials: initials(p.name), avatar: p.avatar }] : [];
  return (
    <SettingRow
      icon={p?.sharing ? <MyLocationRoundedIcon /> : <LocationOffRoundedIcon />}
      tint="#2563EB"
      label={T("Location")}
      sub={
        !data
          ? "…"
          : !p?.sharing
            ? isMe
              ? T("You're not sharing. Turn it on in Account → Settings.")
              : T("Not sharing their location.")
            : seen
              ? T("Seen {when}", { when: seen.text }) + (p.location?.accuracy ? ` · ±${Math.round(p.location.accuracy)} m` : "")
              : T("Sharing, no position yet")
      }
      right={
        p && !p.sharing && !isMe ? (
          <Button size="small" variant="outlined" disabled={busy === uid} onClick={() => void ask(uid)}>
            {T("Ask to share")}
          </Button>
        ) : undefined
      }
    >
      {pins.length > 0 && <MapView pins={pins} picked={String(uid)} height={180} testId="person-map" />}
    </SettingRow>
  );
}
