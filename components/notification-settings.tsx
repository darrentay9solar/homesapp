"use client";

import BedtimeRoundedIcon from "@mui/icons-material/BedtimeRounded";
import NotificationsPausedRoundedIcon from "@mui/icons-material/NotificationsPausedRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { PushSetup } from "@/components/alerts";
import { Field, MDialog } from "@/components/m";
import { ApiError, useFetcher } from "@/lib/client/api";
import { isAdmin, useApp, useMe } from "@/lib/client/app-state";
import { locale, useT } from "@/lib/client/i18n";
import { CATEGORIES, DEFAULT_PREFS, isPaused, type PauseChoice, pauseUntil, type Prefs } from "@/lib/client/prefs";

function Row({ label, sub, checked, onChange, testId }: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <FormControlLabel
      labelPlacement="start"
      sx={{ mx: 0, py: 0.75, gap: 2, width: "100%", justifyContent: "space-between", alignItems: "center" }}
      control={<Switch checked={checked} onChange={(e) => onChange(e.target.checked)} slotProps={{ input: { "aria-label": label, ...(testId ? { "data-testid": testId } : {}) } as object }} />}
      label={
        <Box>
          <Typography sx={{ fontWeight: 500, fontSize: 14.5 }}>{label}</Typography>
          {sub && (
            <Typography variant="caption" component="div" sx={{ color: "text.secondary" }}>
              {sub}
            </Typography>
          )}
        </Box>
      }
    />
  );
}

/**
 * When and what to be told about. Alerts always stay on the Alerts screen;
 * these settings decide what also reaches the phone, email and WhatsApp.
 */
export function NotificationsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const me = useMe();
  const { me: state, reloadMe, toast } = useApp();
  const fetcher = useFetcher();
  const [p, setP] = useState<Prefs>(state?.settings?.notificationPrefs ?? DEFAULT_PREFS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paused = isPaused(p);

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setP((x) => ({ ...x, [k]: v }));
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetcher<{ message: string }>("/me/settings", { method: "PATCH", json: { notificationPrefs: p } });
      toast(r.message);
      await reloadMe();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Couldn't save your settings."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <MDialog title="Notifications" heading="When and what to be told" subtitle="Alerts always stay on the Alerts screen. These choose what also reaches your phone, email and WhatsApp." onClose={onClose}>
      <Card sx={{ px: 2, py: 1.5 }}>
        <Stack direction="row" sx={{ gap: 1, alignItems: "center", mb: 1 }}>
          <NotificationsPausedRoundedIcon sx={{ color: "warning.main" }} />
          <Typography sx={{ fontWeight: 600 }}>{t("Pause")}</Typography>
        </Stack>
        {paused ? (
          <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
            <Typography variant="body2" sx={{ flex: 1 }} data-testid="paused-until">
              {t("Paused until {time}", { time: fmt(p.pausedUntil!) })}
            </Typography>
            <Button size="small" onClick={() => set("pausedUntil", null)}>
              {t("Resume now")}
            </Button>
          </Stack>
        ) : (
          <Field select label="Silence everything for" icon={<NotificationsPausedRoundedIcon />} value="off" onChange={(e) => set("pausedUntil", pauseUntil(e.target.value as PauseChoice))} slotProps={{ htmlInput: { "data-testid": "pause" } }}>
            <MenuItem value="off">{t("Not paused")}</MenuItem>
            <MenuItem value="1h">{t("1 hour")}</MenuItem>
            <MenuItem value="8h">{t("8 hours")}</MenuItem>
            <MenuItem value="morning">{t("Until 8 am tomorrow")}</MenuItem>
            <MenuItem value="week">{t("1 week")}</MenuItem>
          </Field>
        )}
      </Card>

      <Card sx={{ px: 2, py: 1.5, mt: 2 }}>
        <Row label={t("Quiet hours")} sub={t("Every day, Singapore time")} checked={p.quiet.on} onChange={(on) => set("quiet", { ...p.quiet, on })} testId="quiet-on" />
        {p.quiet.on && (
          <Stack direction="row" sx={{ gap: 1.5, mt: 1.5 }}>
            <Field label="From" type="time" icon={<BedtimeRoundedIcon />} value={p.quiet.from} onChange={(e) => set("quiet", { ...p.quiet, from: e.target.value || "22:00" })} slotProps={{ htmlInput: { "data-testid": "quiet-from" } }} />
            <Field label="To" type="time" icon={<ScheduleRoundedIcon />} value={p.quiet.to} onChange={(e) => set("quiet", { ...p.quiet, to: e.target.value || "07:00" })} slotProps={{ htmlInput: { "data-testid": "quiet-to" } }} />
          </Stack>
        )}
        <Divider sx={{ my: 1 }} />
        <Row label={t("Crews running late always get through")} sub={t("Even while paused or in quiet hours")} checked={p.urgent} onChange={(v) => set("urgent", v)} />
      </Card>

      <Typography sx={{ fontWeight: 600, mt: 2.5, mb: 1 }}>{t("What to be told about")}</Typography>
      <Card sx={{ px: 2, py: 0.5 }}>
        {CATEGORIES.filter((c) => !c.pm || isAdmin(me?.role)).map((c, i) => (
          <Box key={c.key}>
            {i > 0 && <Divider />}
            <Row
              label={t(c.label)}
              sub={t(c.sub)}
              checked={!p.mute.includes(c.key)}
              onChange={(on) => set("mute", on ? p.mute.filter((m) => m !== c.key) : [...p.mute, c.key])}
              testId={`cat-${c.key}`}
            />
          </Box>
        ))}
      </Card>

      <Typography sx={{ fontWeight: 600, mt: 2.5, mb: 1 }}>{t("How")}</Typography>
      <Card sx={{ px: 2, py: 0.5 }}>
        <Row label={t("Phone notifications")} checked={p.channels.push} onChange={(v) => set("channels", { ...p.channels, push: v })} />
        <Divider />
        <Row label={t("Email")} checked={p.channels.email} onChange={(v) => set("channels", { ...p.channels, email: v })} />
        <Divider />
        <Row label={t("WhatsApp or SMS")} checked={p.channels.mobile} onChange={(v) => set("channels", { ...p.channels, mobile: v })} />
      </Card>
      <PushSetup />

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
      <Stack sx={{ gap: 1, mt: 3 }}>
        <Button size="large" variant="contained" disabled={busy} onClick={() => void save()} data-testid="save-notifications">
          {busy ? t("Saving…") : t("Save")}
        </Button>
        <Button size="large" onClick={onClose}>
          {t("Cancel")}
        </Button>
      </Stack>
    </MDialog>
  );
}
