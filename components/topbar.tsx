"use client";

import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Stack from "@mui/material/Stack";
import type { Theme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { type ReactNode, useEffect, useRef } from "react";

import { type Role, useApp } from "@/lib/client/app-state";
import { ROLE_COLOR } from "@/lib/client/mui-theme";

import { PAGE_COLUMN, PAGE_GUTTER } from "./shell";

/**
 * The list screens' shared pieces (People, Audit): the compact green header
 * with its wavy edge, the search box and pill tabs inside it, section
 * headings, and cards with a coloured left edge.
 */

export const HERO_BG = "linear-gradient(145deg, #0E7F53 0%, #0A5C3E 55%, #073f2b 100%)";

/** One card per row on phones and tablets; two per row on desktop. */
export const GRID = {
  display: "grid",
  gap: { xs: 1.25, lg: 2 },
  gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" },
} as const;

export const roleColor = (role: Role) => (t: Theme) => (t.palette.mode === "dark" ? ROLE_COLOR[role].dark : ROLE_COLOR[role].light);

/**
 * The compact green header: title with an action and alerts, then search,
 * then the pill tabs. Scrolls away with the page so it never takes over a phone.
 */
export function TopBar({ title, action, search, tabs }: { title: string; action?: ReactNode; search?: ReactNode; tabs?: ReactNode }) {
  const { me } = useApp();
  const unread = me?.unread ?? 0;
  return (
    <Box
      component="header"
      sx={{
        background: HERO_BG,
        color: "#fff",
        px: PAGE_GUTTER,
        pt: { xs: "calc(10px + env(safe-area-inset-top))", lg: 3 },
        // Room for the wave, which is drawn over the bottom of the header.
        pb: { xs: "40px", lg: "52px" },
        position: "relative",
      }}
    >
      <Box sx={PAGE_COLUMN}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, minHeight: 44 }}>
          <Typography component="h1" sx={{ flex: 1, fontWeight: 600, fontSize: { xs: 20, lg: 24 } }}>
            {title}
          </Typography>
          {action}
          <IconButton component={Link} href="/alerts" aria-label={unread ? `${unread} unread alerts` : "Alerts"} sx={{ color: "#fff" }}>
            <Badge color="warning" variant="dot" invisible={!unread}>
              <NotificationsRoundedIcon />
            </Badge>
          </IconButton>
        </Stack>
        {search && <Box sx={{ mt: 1 }}>{search}</Box>}
        {tabs}
      </Box>
      {/* The wavy bottom edge from the account screens: lower on the left,
          rising to the right. The page colour fills in below the curve. */}
      <Box
        component="svg"
        viewBox="0 0 440 40"
        preserveAspectRatio="none"
        aria-hidden="true"
        sx={{ position: "absolute", left: 0, right: 0, bottom: -1, width: "100%", height: { xs: 30, lg: 42 }, display: "block" }}
      >
        <path d="M0 40V30C76 27 150 16 240 18C320 20 384 22 440 0V40Z" fill="var(--mui-palette-background-default)" />
      </Box>
    </Box>
  );
}

export function Heading({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1, mt: 2.5, mb: 1.25 }}>
      <Typography sx={{ fontWeight: 600, fontSize: { xs: 17, lg: 19 } }}>{title}</Typography>
      {count !== undefined && <Chip size="small" label={count} sx={{ height: 20, fontSize: 11 }} />}
      <Box sx={{ flex: 1 }} />
      {action}
    </Stack>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  testId?: string;
}) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 1.25,
        height: 40,
        borderRadius: "12px",
        bgcolor: "rgba(255,255,255,0.12)",
        border: "1px solid rgba(255,255,255,0.2)",
        "&:focus-within": { bgcolor: "rgba(255,255,255,0.18)", borderColor: "rgba(255,255,255,0.55)" },
      }}
    >
      <SearchRoundedIcon sx={{ fontSize: 20, opacity: 0.8 }} />
      <InputBase
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputProps={{ "aria-label": placeholder, "data-testid": testId }}
        sx={{ flex: 1, minWidth: 0, color: "#fff", fontSize: 16, "& input::placeholder": { color: "rgba(255,255,255,0.65)", opacity: 1 } }}
      />
      {value && (
        <IconButton size="small" aria-label="Clear search" onClick={() => onChange("")} sx={{ color: "#fff", p: 0.5 }}>
          <CloseRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      )}
    </Box>
  );
}

/**
 * Pill tabs in a translucent track (the reference's "All / Pending / Ongoing /
 * Completed"). Slides sideways if they don't fit, keeping the chosen tab in view.
 */
export function SegTabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
  label: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    track.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);
  return (
    <Box
      ref={track}
      role="tablist"
      aria-label={label}
      sx={{
        mt: 1,
        display: "flex",
        gap: 0.25,
        p: "3px",
        borderRadius: "12px",
        bgcolor: "rgba(0,0,0,0.2)",
        border: "1px solid rgba(255,255,255,0.14)",
        overflowX: "auto",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <ButtonBase
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            sx={{
              flex: "1 0 auto",
              gap: 0.5,
              px: 1.25,
              height: 32,
              borderRadius: "9px",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: on ? 600 : 500,
              whiteSpace: "nowrap",
              color: on ? "#073f2b" : "rgba(255,255,255,0.85)",
              bgcolor: on ? "#fff" : "transparent",
              transition: "background-color .18s, color .18s",
            }}
          >
            {o.label}
            {o.count !== undefined && (
              <Box component="span" sx={{ fontSize: 10.5, opacity: 0.7 }}>
                {o.count}
              </Box>
            )}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

/** A card with a coloured edge on the left, like the reference's task cards. */
export function EdgeCard({ color, children, dim }: { color: (t: Theme) => string; children: ReactNode; dim?: boolean }) {
  return (
    <Card
      sx={(t) => ({
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        opacity: dim ? 0.6 : 1,
        transition: "box-shadow .2s, transform .2s",
        "&:hover": { boxShadow: "0 18px 40px -26px rgba(0,0,0,0.45)" },
        "&::before": {
          content: '""',
          position: "absolute",
          left: 0,
          top: 12,
          bottom: 12,
          width: 4,
          borderRadius: "0 4px 4px 0",
          bgcolor: color(t),
          zIndex: 1,
        },
      })}
    >
      {children}
    </Card>
  );
}
