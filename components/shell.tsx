"use client";

import AccountCircleRoundedIcon from "@mui/icons-material/AccountCircleRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import FormatListBulletedRoundedIcon from "@mui/icons-material/FormatListBulletedRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import PlaceRoundedIcon from "@mui/icons-material/PlaceRounded";
import Badge from "@mui/material/Badge";
import BottomNavigation from "@mui/material/BottomNavigation";
import BottomNavigationAction from "@mui/material/BottomNavigationAction";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { ACT_AS_KEY } from "@/lib/client/api";
import { type Role, useApp, useMe } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";

import { Logo } from "./icons";
import { RoleAvatar } from "./m";

/** phone: false keeps a tab off the phone's bottom bar (at most five fit); it stays in the desktop drawer. */
type Tab = { href: string; label: string; icon: ReactNode; phone?: false };

/** Tabs per role, from the prototype. Audit is project managers only. */
const TABS: Record<Role, Tab[]> = {
  homeowner: [
    { href: "/", label: "My Project", icon: <HomeRoundedIcon /> },
    { href: "/alerts", label: "Alerts", icon: <NotificationsRoundedIcon /> },
    { href: "/account", label: "Account", icon: <AccountCircleRoundedIcon /> },
  ],
  project_manager: [
    { href: "/", label: "Projects", icon: <FormatListBulletedRoundedIcon /> },
    { href: "/people", label: "People", icon: <GroupsRoundedIcon /> },
    { href: "/alerts", label: "Alerts", icon: <NotificationsRoundedIcon /> },
    { href: "/audit", label: "Audit", icon: <FactCheckRoundedIcon /> },
    { href: "/files", label: "My Files", icon: <FolderOpenRoundedIcon />, phone: false },
    { href: "/account", label: "Account", icon: <AccountCircleRoundedIcon /> },
  ],
  contractor: [
    { href: "/", label: "Projects", icon: <FormatListBulletedRoundedIcon /> },
    { href: "/files", label: "Files", icon: <FolderOpenRoundedIcon /> },
    { href: "/alerts", label: "Alerts", icon: <NotificationsRoundedIcon /> },
    { href: "/account", label: "Account", icon: <AccountCircleRoundedIcon /> },
  ],
  epc_team: [
    { href: "/", label: "Projects", icon: <FormatListBulletedRoundedIcon /> },
    { href: "/sites", label: "Sites", icon: <PlaceRoundedIcon /> },
    { href: "/files", label: "Files", icon: <FolderOpenRoundedIcon /> },
    { href: "/alerts", label: "Alerts", icon: <NotificationsRoundedIcon /> },
    { href: "/account", label: "Account", icon: <AccountCircleRoundedIcon /> },
  ],
};

const DRAWER = DESIGN.layout.drawer;

function activeHref(path: string, tabs: Tab[]): string {
  const pathname = path.replace(/^\/dev-preview(?=\/|$)/, "") || "/";
  const hit = tabs.find((t) => t.href !== "/" && (pathname === t.href || pathname.startsWith(`${t.href}/`)));
  return hit?.href ?? "/";
}

function withBadge(icon: ReactNode, show: boolean) {
  return show ? (
    <Badge color="primary" variant="dot" overlap="circular">
      {icon}
    </Badge>
  ) : (
    icon
  );
}

/**
 * The app frame. Phones: content with a Material bottom navigation bar.
 * Desktop (lg and up): a permanent navigation drawer on the left.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const { me: state } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  if (!me) return null;
  const tabs = TABS[me.role];
  const current = activeHref(pathname, tabs);
  const unread = (state?.unread ?? 0) > 0;

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh", bgcolor: "background.default" }}>
      <Box
        component="nav"
        aria-label="Main"
        sx={{
          display: { xs: "none", lg: "flex" },
          flexDirection: "column",
          width: DRAWER,
          flex: "0 0 auto",
          position: "sticky",
          top: 0,
          height: "100dvh",
          px: 2,
          py: 3,
          borderRight: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Stack direction="row" component={Link} href="/" sx={{ alignItems: "center", gap: 1.5, px: 1, pb: 3 }}>
          <Logo size={36} />
          <Box>
            <Typography sx={{ fontWeight: 600, letterSpacing: "0.2em", fontSize: 13.5 }}>GETHOMEAPPS</Typography>
            <Typography sx={{ color: "text.secondary", letterSpacing: "0.22em", fontSize: 8.5, fontWeight: 600 }}>
              9 SOLAR HOME · 九太阳家
            </Typography>
          </Box>
        </Stack>
        <List sx={{ display: "grid", gap: 0.5, p: 0 }}>
          {tabs.map((t) => (
            <ListItemButton
              key={t.href}
              component={Link}
              href={t.href}
              selected={current === t.href}
              sx={{
                minHeight: 46,
                "&.Mui-selected": { bgcolor: "action.selected", "& .MuiListItemIcon-root": { color: "primary.main" } },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{withBadge(t.icon, t.href === "/alerts" && unread)}</ListItemIcon>
              <ListItemText primary={t.label} slotProps={{ primary: { sx: { fontWeight: 500, fontSize: 14.5 } } }} />
            </ListItemButton>
          ))}
        </List>
        <Box sx={{ flex: 1 }} />
        <Stack
          direction="row"
          component={Link}
          href="/account"
          sx={{ alignItems: "center", gap: 1.5, p: 1.5, borderRadius: `${DESIGN.radius.listItem}px`, border: 1, borderColor: "divider" }}
        >
          <RoleAvatar name={me.fullName ?? me.email} role={me.role} size={38} />
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 600 }}>
              {me.fullName ?? me.email}
            </Typography>
            <Typography noWrap variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              {me.roleLabel}
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {state?.actingAs && <ActingBanner name={me.fullName ?? me.email} role={me.roleLabel} by={state.actingAs.byName} />}
        {children}
      </Box>

      <Paper
        elevation={0}
        sx={{
          display: { xs: "block", lg: "none" },
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: (t) => t.zIndex.appBar,
          borderTop: 1,
          borderColor: "divider",
          pb: "env(safe-area-inset-bottom)",
          backdropFilter: "blur(18px)",
        }}
      >
        <BottomNavigation showLabels value={current} onChange={(_, v: string) => router.push(v)} sx={{ height: 64, bgcolor: "transparent" }}>
          {tabs.filter((t) => t.phone !== false).map((t) => (
            <BottomNavigationAction
              key={t.href}
              value={t.href}
              label={t.label}
              icon={withBadge(t.icon, t.href === "/alerts" && unread)}
            />
          ))}
        </BottomNavigation>
      </Paper>
    </Box>
  );
}

/**
 * Development only: shown while a project manager is testing as someone else,
 * so it's never unclear whose screens these are.
 */
function ActingBanner({ name, role, by }: { name: string; role: string; by: string | null }) {
  return (
    <Box
      role="status"
      sx={{ position: "sticky", top: 0, zIndex: (t) => t.zIndex.appBar + 1, px: 2, py: 0.75, display: "flex", alignItems: "center", gap: 1.5, bgcolor: "warning.main", color: "#1a1204" }}
    >
      <Typography sx={{ flex: 1, fontSize: 13, fontWeight: 600 }} noWrap>
        Acting as {name} ({role}) · development only{by ? ` · you are ${by}` : ""}
      </Typography>
      <Box
        component="button"
        onClick={() => {
          try {
            sessionStorage.removeItem(ACT_AS_KEY);
          } catch {
            /* storage blocked */
          }
          // A full reload on purpose: every screen must start again as yourself.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = "/account";
        }}
        sx={{ border: 0, borderRadius: `${DESIGN.radius.chip}px`, px: 1.25, py: 0.5, fontFamily: "inherit", fontWeight: 700, fontSize: 12.5, cursor: "pointer", bgcolor: "rgba(0,0,0,0.18)", color: "inherit" }}
      >
        Stop
      </Box>
    </Box>
  );
}

/** Page body: comfortable padding, clear of the bottom navigation on phones. */
/**
 * The centred content column. Grows with the screen (so a wide monitor isn't
 * half empty) but stops at a readable width, and stays centred in the space
 * beside the navigation drawer. Headers that span the full width use the same
 * column (PAGE_COLUMN) so their contents line up with the cards below.
 */
export const PAGE_COLUMN = {
  width: "100%",
  maxWidth: { xs: "100%", lg: DESIGN.layout.column.desktop, xl: DESIGN.layout.column.wide },
  mx: "auto",
} as const;

const G = DESIGN.layout.gutter;
export const PAGE_GUTTER = { xs: `${G.phone}px`, sm: `${G.tablet}px`, lg: `${G.desktop}px` } as const;

export function Page({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return (
    <Box
      sx={{
        px: PAGE_GUTTER,
        pt: 1,
        pb: { xs: "calc(96px + env(safe-area-inset-bottom))", lg: 6 },
        width: "100%",
      }}
    >
      <Box data-layout="column" sx={narrow ? { width: "100%", maxWidth: 760, mx: "auto" } : PAGE_COLUMN}>
        {children}
      </Box>
    </Box>
  );
}
