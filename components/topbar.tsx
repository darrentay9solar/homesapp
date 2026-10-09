"use client";

import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
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
import { alpha, type Theme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { type ReactNode, useEffect, useRef } from "react";

import { type Role, useApp } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { useLang } from "@/lib/client/i18n";
import { ROLE_COLOR } from "@/lib/client/mui-theme";

import { PAGE_COLUMN, PAGE_GUTTER } from "./shell";

/**
 * The list screens' shared pieces (People, Audit): the compact green header
 * with its wavy edge, the search box and pill tabs inside it, section
 * headings, and cards with a coloured left edge.
 */

export const HERO_BG = DESIGN.headerGradient;

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
/** Read out by screen readers, not shown. */
const visuallyHidden = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0, margin: "-1px", padding: 0 } as const;

export function TopBar({
  title,
  sub,
  onBack,
  action,
  search,
  tabs,
  hideTitle = false,
}: {
  title: string;
  /** A second line under the title, e.g. a project's address. */
  sub?: ReactNode;
  onBack?: () => void;
  action?: ReactNode;
  search?: ReactNode;
  tabs?: ReactNode;
  /** Keep the title for screen readers only (Account: the tabs say it all). */
  hideTitle?: boolean;
}) {
  const { me } = useApp();
  const { t, tr } = useLang();
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
      <Box data-layout="header-column" sx={PAGE_COLUMN}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, minHeight: 44 }}>
          {onBack && (
            <IconButton onClick={onBack} aria-label={t("Back")} sx={{ color: "#fff", ml: -1 }}>
              <ArrowBackRoundedIcon />
            </IconButton>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              component="h1"
              noWrap
              data-title-hidden={hideTitle || undefined}
              sx={hideTitle ? visuallyHidden : { fontWeight: 600, fontSize: { xs: DESIGN.type.pageTitle.phone, lg: DESIGN.type.pageTitle.desktop } }}
            >
              {tr(title)}
            </Typography>
            {sub && (
              <Typography noWrap sx={{ fontSize: { xs: 12.5, lg: 14 }, color: "rgba(255,255,255,0.78)" }}>
                {typeof sub === "string" ? tr(sub) : sub}
              </Typography>
            )}
          </Box>
          {action}
          <IconButton component={Link} href="/alerts" aria-label={unread ? t("{n} unread alerts", { n: unread }) : t("Alerts")} sx={{ color: "#fff" }}>
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
  const { tr } = useLang();
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1, mt: 2.5, mb: 1.25 }}>
      <Typography component="h2" sx={{ fontWeight: 600, fontSize: { xs: DESIGN.type.sectionTitle.phone, lg: DESIGN.type.sectionTitle.desktop } }}>
        {tr(title)}
      </Typography>
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
  const { t, tr } = useLang();
  placeholder = tr(placeholder);
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
        borderRadius: `${DESIGN.radius.control}px`,
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
        <IconButton size="small" aria-label={t("Clear search")} onClick={() => onChange("")} sx={{ color: "#fff", p: 0.5 }}>
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
  const { tr } = useLang();
  useEffect(() => {
    track.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);
  return (
    <Box
      ref={track}
      role="tablist"
      aria-label={tr(label)}
      sx={{
        mt: 1,
        display: "flex",
        gap: 0.25,
        p: "3px",
        borderRadius: `${DESIGN.radius.control}px`,
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
              borderRadius: `${DESIGN.radius.controlInner}px`,
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: on ? 600 : 500,
              whiteSpace: "nowrap",
              color: on ? "#073f2b" : "rgba(255,255,255,0.85)",
              bgcolor: on ? "#fff" : "transparent",
              transition: "background-color .18s, color .18s",
            }}
          >
            {tr(o.label)}
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
/** The red of a project with an issue: a red card, red border, a soft red glow. */
export function alarmSx(t: Theme) {
  const a = DESIGN.alarm;
  return {
    bgcolor: a.light.bg,
    border: `2px solid ${a.light.border}`,
    boxShadow: `0 0 0 3px ${alpha(a.light.border, 0.18)}`,
    ...t.applyStyles("dark", { bgcolor: a.dark.bg, borderColor: a.dark.border, boxShadow: `0 0 0 3px ${alpha(a.dark.border, 0.2)}` }),
  };
}

export function EdgeCard({ color, children, dim, alarm }: { color: (t: Theme) => string; children: ReactNode; dim?: boolean; alarm?: boolean }) {
  return (
    <Card
      data-alarm={alarm || undefined}
      sx={(t) => ({
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        opacity: dim ? 0.6 : 1,
        // Something's wrong (late, or a crew no-show): the whole card is red, impossible to miss.
        ...(alarm && alarmSx(t)),
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
