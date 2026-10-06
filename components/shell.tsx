"use client";

import AccountCircleRoundedIcon from "@mui/icons-material/AccountCircleRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
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

import { type Role, useApp, useMe } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";

import { Logo } from "./icons";
import { RoleAvatar } from "./m";

type Tab = { href: string; label: string; icon: ReactNode };

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
    { href: "/account", label: "Account", icon: <AccountCircleRoundedIcon /> },
  ],
  contractor: [
    { href: "/", label: "Projects", icon: <FormatListBulletedRoundedIcon /> },
    { href: "/alerts", label: "Alerts", icon: <NotificationsRoundedIcon /> },
    { href: "/account", label: "Account", icon: <AccountCircleRoundedIcon /> },
  ],
  epc_team: [
    { href: "/", label: "Projects", icon: <FormatListBulletedRoundedIcon /> },
    { href: "/sites", label: "Sites", icon: <PlaceRoundedIcon /> },
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

      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>{children}</Box>

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
          {tabs.map((t) => (
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
