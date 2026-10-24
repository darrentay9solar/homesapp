"use client";

import AccountCircleRoundedIcon from "@mui/icons-material/AccountCircleRounded";
import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import ElectricBoltRoundedIcon from "@mui/icons-material/ElectricBoltRounded";
import ExpandLessRoundedIcon from "@mui/icons-material/ExpandLessRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import FormatListBulletedRoundedIcon from "@mui/icons-material/FormatListBulletedRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import HandymanRoundedIcon from "@mui/icons-material/HandymanRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import HomeWorkRoundedIcon from "@mui/icons-material/HomeWorkRounded";
import InfoRoundedIcon from "@mui/icons-material/InfoRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import PhonelinkLockRoundedIcon from "@mui/icons-material/PhonelinkLockRounded";
import PlaceRoundedIcon from "@mui/icons-material/PlaceRounded";
import PrivacyTipOutlinedIcon from "@mui/icons-material/PrivacyTipOutlined";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import SupportAgentRoundedIcon from "@mui/icons-material/SupportAgentRounded";
import WbSunnyRoundedIcon from "@mui/icons-material/WbSunnyRounded";
import Alert from "@mui/material/Alert";
import Badge from "@mui/material/Badge";
import BottomNavigation from "@mui/material/BottomNavigation";
import BottomNavigationAction from "@mui/material/BottomNavigationAction";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { ACT_AS_KEY, useFetcher } from "@/lib/client/api";
import { type Role, useApp, useMe } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { needsPrivacyAgreement } from "@/lib/client/privacy";

import { Logo } from "./icons";
import { IdleSignOut } from "./idle";
import { RoleAvatar } from "./m";

import { T, TR } from "@/lib/client/i18n";
import { leaveDemo } from "@/lib/client/demo";
/**
 * Every role's screens in three groups, as 9 Solar Home asked (23 Oct 2026): Homes (the homes and their
 * money, and support), Admin (people, records and one's own tools), Info (FusionSolar and SP Power). The
 * desktop drawer lists them under their group's heading. A phone's bottom bar shows someone's screens
 * themselves when they have five or fewer; more, and it has the groups, each a dropdown (a group with one
 * screen opens it straight away).
 */
const BAR_MOST = 5;
type Group = "homes" | "admin" | "info";
type Tab = { href: string; label: string; icon: ReactNode; group: Group };

const GROUPS: Array<{ key: Group; label: string; icon: ReactNode }> = [
  { key: "homes", label: "Homes", icon: <HomeWorkRoundedIcon /> },
  { key: "admin", label: "Admin", icon: <AdminPanelSettingsRoundedIcon /> },
  { key: "info", label: "Info", icon: <InfoRoundedIcon /> },
];

const DASHBOARD: Tab = { href: "/dashboard", label: "Dashboard", icon: <InsightsRoundedIcon />, group: "homes" };
const PROJECTS: Tab = { href: "/projects", label: "Projects", icon: <FormatListBulletedRoundedIcon />, group: "homes" };
const MAINTENANCE: Tab = { href: "/maintenance", label: "Maintenance", icon: <HandymanRoundedIcon />, group: "homes" };
// Payments: a homeowner's invoices and the QR; for managers, whether each month is issued and paid.
const PAYMENTS: Tab = { href: "/payments", label: "Payments", icon: <ReceiptLongRoundedIcon />, group: "homes" };
const FINANCE: Tab = { href: "/finance", label: "Payments", icon: <ReceiptLongRoundedIcon />, group: "homes" };
const ACCOUNT: Tab = { href: "/account", label: "Account", icon: <AccountCircleRoundedIcon />, group: "admin" };
const PEOPLE: Tab = { href: "/people", label: "People", icon: <GroupsRoundedIcon />, group: "admin" };
const AUDIT: Tab = { href: "/audit", label: "Audit", icon: <FactCheckRoundedIcon />, group: "admin" };
// Help (a homeowner asks) and Support (everyone else answers or helps).
const HELP: Tab = { href: "/support", label: "Help", icon: <SupportAgentRoundedIcon />, group: "homes" };
const SUPPORT: Tab = { href: "/support", label: "Support", icon: <SupportAgentRoundedIcon />, group: "homes" };
const ALERTS: Tab = { href: "/alerts", label: "Alerts", icon: <NotificationsRoundedIcon />, group: "admin" };
const CALENDAR: Tab = { href: "/calendar", label: "Calendar", icon: <CalendarMonthRoundedIcon />, group: "admin" };
const FILES: Tab = { href: "/files", label: "My Files", icon: <FolderOpenRoundedIcon />, group: "admin" };
// FusionSolar's figures for every plant (a project manager: those they run); SP Group's tariff, for everyone.
const FUSIONSOLAR: Tab = { href: "/solar", label: "FusionSolar", icon: <WbSunnyRoundedIcon />, group: "info" };
const SP_POWER: Tab = { href: "/sp-power", label: "SP Power", icon: <ElectricBoltRoundedIcon />, group: "info" };

const OFFICE: Tab[] = [DASHBOARD, PROJECTS, MAINTENANCE, FINANCE, SUPPORT, ACCOUNT, PEOPLE, AUDIT, ALERTS, CALENDAR, FILES, FUSIONSOLAR, SP_POWER];

const TABS: Record<Role, Tab[]> = {
  homeowner: [
    { href: "/", label: "My Project", icon: <HomeRoundedIcon />, group: "homes" },
    PAYMENTS,
    HELP,
    ACCOUNT,
    ALERTS,
    CALENDAR,
    { href: "/my-solar", label: "My FusionSolar", icon: <WbSunnyRoundedIcon />, group: "info" },
    SP_POWER,
  ],
  // The dashboard is a manager's opening screen ("/" takes them there); the Projects list is /projects.
  project_manager: OFFICE,
  // Everything a project manager has, over every project.
  superadmin: OFFICE,
  // Admin (finance): payments first; every project and system to look at, read-only.
  finance: [FINANCE, PROJECTS, MAINTENANCE, SUPPORT, ACCOUNT, ALERTS, CALENDAR, FILES, FUSIONSOLAR, SP_POWER],
  contractor: [{ ...PROJECTS, href: "/" }, SUPPORT, ACCOUNT, ALERTS, CALENDAR, { ...FILES, label: "Files" }, SP_POWER],
  epc_team: [
    { ...PROJECTS, href: "/" },
    { href: "/sites", label: "Sites", icon: <PlaceRoundedIcon />, group: "homes" },
    SUPPORT,
    ACCOUNT,
    ALERTS,
    CALENDAR,
    { ...FILES, label: "Files" },
    SP_POWER,
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
  // The phone's group whose dropdown is open, and the button it hangs from.
  const [menu, setMenu] = useState<{ group: Group; at: HTMLElement } | null>(null);
  if (!me) return null;
  const tabs = TABS[me.role];
  const current = activeHref(pathname, tabs);
  const unread = (state?.unread ?? 0) > 0;
  // A dot on Alerts for unread alerts, on Help or Support for a new answer or someone waiting.
  const support = (state?.supportUnread ?? 0) + (state?.supportWaiting ?? 0) > 0;
  const dot = (href: string) => (href === "/alerts" && unread) || (href === "/support" && support);
  const groups = GROUPS.map((g) => ({ ...g, tabs: tabs.filter((t) => t.group === g.key) })).filter((g) => g.tabs.length);
  const here = tabs.find((t) => t.href === current)?.group ?? "homes";

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh", bgcolor: "background.default" }}>
      <Box
        component="nav"
        aria-label={T("Main")}
        data-nav="side"
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
        {/* The brand on the same green as every page's header: the sidebar starts where the page does. */}
        <Stack
          direction="row"
          component={Link}
          href="/"
          data-testid="nav-brand"
          sx={{
            alignItems: "center",
            gap: 1.5,
            mx: -2,
            mt: -3,
            mb: 2.5,
            px: 3,
            py: 2.75,
            color: "#fff",
            textDecoration: "none",
            background: DESIGN.headerGradient,
            "&:focus-visible": { outline: "2px solid #fff", outlineOffset: -4 },
          }}
        >
          <Logo size={36} color="#fff" />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600, letterSpacing: "0.2em", fontSize: 13.5, color: "#fff" }}>{T("GETHOMEAPPS")}</Typography>
            <Typography sx={{ color: "rgba(255,255,255,0.78)", letterSpacing: "0.22em", fontSize: 8.5, fontWeight: 600 }}>
              {T("9 SOLAR HOME · 九太阳家")}
            </Typography>
          </Box>
        </Stack>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", mx: -1, px: 1 }}>
          {groups.map((g) => (
            <List
              key={g.key}
              sx={{ display: "grid", gap: 0.25, p: 0, mb: 1.5 }}
              aria-label={TR(g.label)}
              data-testid={`nav-group-${g.key}`}
              subheader={
                <ListSubheader disableSticky sx={{ bgcolor: "transparent", lineHeight: 1.6, px: 1, pb: 0.5, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "text.secondary" }}>
                  {TR(g.label)}
                </ListSubheader>
              }
            >
              {g.tabs.map((t) => (
                <ListItemButton
                  key={t.href}
                  component={Link}
                  href={t.href}
                  selected={current === t.href}
                  sx={{
                    minHeight: 42,
                    "&.Mui-selected": { bgcolor: "action.selected", "& .MuiListItemIcon-root": { color: "primary.main" } },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>{withBadge(t.icon, dot(t.href))}</ListItemIcon>
                  <ListItemText primary={TR(t.label)} slotProps={{ primary: { sx: { fontWeight: 500, fontSize: 14.5 } } }} />
                </ListItemButton>
              ))}
            </List>
          ))}
        </Box>
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
              {TR(me.roleLabel)}
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {state?.actingAs && <ActingBanner name={me.fullName ?? me.email} role={TR(me.roleLabel)} by={state.actingAs.byName} />}
        {state?.demo && <DemoBanner name={me.fullName ?? me.email} role={TR(me.roleLabel)} />}
        {!state?.actingAs && needsPrivacyAgreement(state?.settings?.privacy) && <PrivacyBanner />}
        {state?.settings?.twoStepNeeded && <TwoStepBanner />}
        {/* Staff sign out after 30 idle minutes; not homeowners (only their own records), the demo or the previews. */}
        {me.role !== "homeowner" && !state?.demo && !pathname.startsWith("/dev-preview") && <IdleSignOut />}
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
        {tabs.length <= BAR_MOST ? (
          <BottomNavigation showLabels value={current} onChange={(_, v: string) => router.push(v)} sx={{ height: 64, bgcolor: "transparent" }}>
            {tabs.map((t) => (
              <BottomNavigationAction key={t.href} value={t.href} label={TR(t.label)} icon={withBadge(t.icon, dot(t.href))} />
            ))}
          </BottomNavigation>
        ) : (
        <BottomNavigation showLabels value={menu?.group ?? here} sx={{ height: 64, bgcolor: "transparent" }}>
          {groups.map((g) => (
            <BottomNavigationAction
              key={g.key}
              value={g.key}
              label={TR(g.label)}
              data-testid={`nav-${g.key}`}
              aria-haspopup="menu"
              aria-expanded={menu?.group === g.key}
              icon={withBadge(menu?.group === g.key ? <ExpandLessRoundedIcon /> : g.icon, g.tabs.some((t) => dot(t.href)))}
              onClick={(e) => (g.tabs.length === 1 ? router.push(g.tabs[0].href) : setMenu({ group: g.key, at: e.currentTarget }))}
            />
          ))}
        </BottomNavigation>
        )}
      </Paper>

      {/* Phones: each group's screens as a dropdown from its button on the bar. */}
      <Menu
        open={Boolean(menu)}
        anchorEl={menu?.at}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
        slotProps={{ paper: { sx: { minWidth: 220, maxWidth: "calc(100vw - 32px)", mb: 1 } }, list: { "aria-label": menu ? TR(GROUPS.find((x) => x.key === menu.group)?.label ?? "") : undefined, dense: false } as object }}
        data-testid="nav-menu"
      >
        {(groups.find((g) => g.key === menu?.group)?.tabs ?? []).map((t) => (
          <MenuItem
            key={t.href}
            component={Link}
            href={t.href}
            selected={current === t.href}
            onClick={() => setMenu(null)}
            sx={{ minHeight: 48, gap: 1.5 }}
          >
            <Box sx={{ display: "grid", color: current === t.href ? "primary.main" : "text.secondary" }}>{withBadge(t.icon, dot(t.href))}</Box>
            <Typography sx={{ fontWeight: 500, fontSize: 15.5 }}>{TR(t.label)}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

/**
 * Someone who hasn't agreed to the current privacy notice: added by a manager,
 * there before the notice, or the notice has changed since. Asked here, once,
 * until they agree (PDPA).
 */
function PrivacyBanner() {
  const { reloadMe, toast } = useApp();
  const fetcher = useFetcher();
  const [busy, setBusy] = useState(false);
  const agree = async () => {
    setBusy(true);
    try {
      await fetcher("/me/privacy", { method: "POST" });
      await reloadMe();
    } catch (e) {
      toast(e instanceof Error ? e.message : T("Something went wrong. Please try again."), "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box sx={{ px: PAGE_GUTTER, pt: 1.5 }} data-testid="privacy-banner">
      <Alert
        severity="info"
        icon={<PrivacyTipOutlinedIcon />}
        action={
          <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
            <Button size="small" component={Link} href="/privacy" target="_blank" rel="noopener" color="inherit">
              {T("Read it")}
            </Button>
            <Button size="small" variant="contained" disabled={busy} onClick={() => void agree()}>
              {T("I agree")}
            </Button>
          </Stack>
        }
      >
        {T("Please read our privacy notice: how 9 Solar Home uses your details to run your account and projects.")}
      </Alert>
    </Box>
  );
}

/**
 * Staff whose role needs two-step verification (REQUIRE_STAFF_MFA) and who signed in
 * without it: everything but their own account is closed until they set it up.
 */
function TwoStepBanner() {
  return (
    <Box sx={{ px: PAGE_GUTTER, pt: 1.5 }} data-testid="two-step-banner">
      <Alert
        severity="warning"
        icon={<PhonelinkLockRoundedIcon />}
        action={
          <Button size="small" variant="contained" color="warning" component={Link} href="/account?tab=security">
            {T("Set up")}
          </Button>
        }
      >
        {T("Your role needs two-step verification. Set it up in Account → Security, then sign in again.")}
      </Alert>
    </Box>
  );
}

/** The demonstration site: whose screens these are, and a way to be someone else. */
function DemoBanner({ name, role }: { name: string; role: string }) {
  return (
    <Box
      role="status"
      data-testid="demo-banner"
      sx={{ position: "sticky", top: 0, zIndex: (t) => t.zIndex.appBar + 1, px: 2, py: 0.75, display: "flex", alignItems: "center", gap: 1.5, bgcolor: "info.main", color: "#fff" }}
    >
      <Typography sx={{ flex: 1, fontSize: 13, fontWeight: 600 }} noWrap>
        {T("Demo · you're {name} ({role}) · sample data", { name, role })}
      </Typography>
      <Box
        component="button"
        onClick={() => {
          leaveDemo();
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = "/sign-in";
        }}
        sx={{ border: 0, borderRadius: `${DESIGN.radius.chip}px`, px: 1.25, py: 0.5, fontFamily: "inherit", fontWeight: 700, fontSize: 12.5, cursor: "pointer", bgcolor: "rgba(0,0,0,0.2)", color: "inherit", whiteSpace: "nowrap" }}
      >
        {T("Switch person")}
      </Box>
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
        {T("Acting as {name} ({role}) · development only", { name, role: TR(role) })}
        {by ? ` · ${T("you are {name}", { name: by })}` : ""}
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
        {T("Stop")}
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
