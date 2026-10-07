"use client";

import DoneAllRoundedIcon from "@mui/icons-material/DoneAllRounded";
import NotificationsNoneRoundedIcon from "@mui/icons-material/NotificationsNoneRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { PushSetup } from "@/components/alerts";
import { Page } from "@/components/shell";
import { EdgeCard, GRID, Heading, SegTabs, TopBar } from "@/components/topbar";
import { type AlertRow, type AlertTab, filterAlerts, groupByDay, safeLink, timeOf } from "@/lib/client/alerts";
import { useApi, useFetcher } from "@/lib/client/api";
import { useApp, useMe } from "@/lib/client/app-state";
import { setBadge } from "@/lib/client/push";

import { T, TR } from "@/lib/client/i18n";
type Data = { alerts: AlertRow[]; more: boolean; unread: number };

function AlertCard({ a, onOpen }: { a: AlertRow; onOpen: () => void }) {
  return (
    <EdgeCard color={(t) => (a.urgent ? t.palette.error.main : a.read ? t.palette.divider : t.palette.primary.main)} dim={a.read}>
      <Box
        component="button"
        onClick={onOpen}
        data-testid="alert-card"
        sx={{ all: "unset", cursor: "pointer", display: "block", flex: 1, minWidth: 0, p: 1.5, pl: 2.25, "&:focus-visible": { outline: 2, outlineColor: "primary.main" } }}
      >
        <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
          {!a.read && <Box aria-label={T("Unread")} sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: a.urgent ? "error.main" : "primary.main", flex: "0 0 auto" }} />}
          <Chip size="small" label={TR(a.kindLabel)} color={a.urgent ? "error" : "default"} variant={a.urgent ? "filled" : "outlined"} />
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {timeOf(a.createdAt)}
          </Typography>
        </Stack>
        <Typography sx={{ fontWeight: a.read ? 500 : 700, fontSize: 15.5, mt: 0.75, overflowWrap: "anywhere" }}>{TR(a.title)}</Typography>
        {a.body && (
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25, overflowWrap: "anywhere" }}>
            {TR(a.body)}
          </Typography>
        )}
        {a.projectName && (
          <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 600, display: "block", mt: 0.75 }}>
            {a.projectName} →
          </Typography>
        )}
      </Box>
    </EdgeCard>
  );
}

function AlertsScreen() {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fetcher = useFetcher();
  const { reloadMe, toast } = useApp();
  const { data, error, reload } = useApi<Data>(me ? "/alerts" : null);
  const [older, setOlder] = useState<AlertRow[]>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const [tab, setTab] = useState<AlertTab>("all");
  const preview = pathname.startsWith("/dev-preview");
  const inApp = (link: string) => (preview && link !== "/alerts" ? `/dev-preview${link}` : link);

  const markRead = useCallback(
    async (json: { ids?: number[]; all?: boolean }) => {
      const r = await fetcher<{ unread: number }>("/alerts/read", { method: "POST", json });
      setBadge(r.unread);
      await Promise.all([reload(), reloadMe()]);
    },
    [fetcher, reload, reloadMe]
  );

  // Opened from a phone notification: mark it read, then go where it points.
  useEffect(() => {
    const open = Number(params.get("open"));
    if (!open) return;
    const to = safeLink(params.get("to"));
    void markRead({ ids: [open] }).finally(() => router.replace(inApp(to)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per notification tap
  }, [params]);

  // A notification arrived while this screen is open: show it.
  useEffect(() => {
    const onAlert = () => void reload();
    window.addEventListener("gha-alert", onAlert);
    return () => window.removeEventListener("gha-alert", onAlert);
  }, [reload]);

  useEffect(() => {
    if (data) setBadge(data.unread);
  }, [data]);

  if (!me) return null;
  const all = [...(data?.alerts ?? []), ...older];
  const shown = filterAlerts(all, tab);
  const groups = groupByDay(shown);
  const unread = data?.unread ?? 0;
  const hasMore = more ?? data?.more ?? false;

  async function open(a: AlertRow) {
    if (!a.read) await markRead({ ids: [a.id] }).catch(() => undefined);
    router.push(inApp(safeLink(a.link)));
  }

  async function loadOlder() {
    const last = all[all.length - 1];
    try {
      const r = await fetcher<Data>(`/alerts?before=${last.id}`);
      setOlder((o) => [...o, ...r.alerts]);
      setMore(r.more);
    } catch {
      toast("Couldn't load older alerts.", "bad");
    }
  }

  const TABS: Array<[AlertTab, string]> = [
    ["all", "All"],
    ["unread", "Unread"],
    ["late", "Running late"],
  ];

  return (
    <>
      <TopBar
        title={T("Alerts")}
        sub={unread ? T("{n} unread", { n: unread }) : "All caught up"}
        action={
          unread > 0 ? (
            <Button onClick={() => void markRead({ all: true })} startIcon={<DoneAllRoundedIcon />} sx={{ color: "#073f2b", bgcolor: "#fff", height: 36, "&:hover": { bgcolor: "#eafff4" } }} data-testid="mark-all-read">
              <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                {T("Mark all read")}
              </Box>
              <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
                {T("Read all")}
              </Box>
            </Button>
          ) : undefined
        }
        tabs={<SegTabs label={T("Filter alerts")} value={tab} onChange={setTab} options={TABS.map(([v, l]) => ({ value: v, label: l, count: filterAlerts(all, v).length }))} />}
      />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          <PushSetup compact />
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {!data && !error && (
            <Box sx={{ ...GRID, mt: 3 }}>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} variant="rounded" height={104} />
              ))}
            </Box>
          )}
          {data && shown.length === 0 && (
            <Card sx={{ p: 4, mt: 2, textAlign: "center" }} data-testid="alerts-empty">
              <NotificationsNoneRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
              <Typography sx={{ fontWeight: 600, mt: 1 }}>{tab === "all" ? T("No alerts yet") : tab === "unread" ? T("You're all caught up") : T("No crews running late")}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                {T("Approvals, site visits, milestones and crews running late appear here, and on your phone if you turn notifications on.")}
              </Typography>
            </Card>
          )}
          {groups.map((g) => (
            <Box key={TR(g.label)}>
              <Heading title={TR(g.label)} count={g.alerts.length} />
              <Box sx={GRID}>
                {g.alerts.map((a) => (
                  <AlertCard key={a.id} a={a} onOpen={() => void open(a)} />
                ))}
              </Box>
            </Box>
          ))}
          {hasMore && tab === "all" && (
            <Stack sx={{ alignItems: "center", mt: 2.5 }}>
              <Button onClick={() => void loadOlder()}>{T("Show older alerts")}</Button>
            </Stack>
          )}
        </Page>
      </Box>
    </>
  );
}

/** Everything the app has told you, newest first; each one opens what it's about. */
export default function AlertsPage() {
  return (
    <Suspense>
      <AlertsScreen />
    </Suspense>
  );
}
