"use client";

import DrawRoundedIcon from "@mui/icons-material/DrawRounded";
import HandymanRoundedIcon from "@mui/icons-material/HandymanRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { type PointerEvent, type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";

import { Field, MDialog } from "@/components/m";
import { useMaintenanceHref } from "@/components/maintenance";
import { dt2s } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { useApp, useMe } from "@/lib/client/app-state";
import { T, TR } from "@/lib/client/i18n";
import type { ProjectRow } from "@/lib/client/projects";

/** What GET /projects/{id}/handover returns. */
export type Handover = {
  status: ProjectRow["status"];
  milestone3: boolean;
  certificate: { title: string; issuer: string; number: string; rows: Array<[string, string]>; statement: string };
  fingerprint: string;
  signature: { name: string; at: string } | null;
  pdf: string | null;
  closed: { at: string; by: string | null } | null;
  /** Handed over: its maintenance record, for a project manager. */
  maintenance?: number | null;
  actions: { sign: boolean; request: boolean; remind: boolean; close: boolean };
};

const SHOWN = new Set(["awaiting_signature", "signed", "closed"]);

/** Whether the project page should load the handover at all. */
export function atHandover(p: ProjectRow): boolean {
  return SHOWN.has(p.status) || (p.milestone === 3 && (p.status === "in_progress" || p.status === "pm_approved"));
}

/**
 * The handover, from the brief: when the project completes the homeowner
 * e-signs the installation certificate on their phone, the project manager is
 * alerted, checks it and closes the project. One banner says where it stands,
 * with the next step as a button for whoever takes it.
 */
export function HandoverPanel({ p, reload }: { p: ProjectRow; reload: () => Promise<void> }) {
  const { data: h, reload: reloadHandover } = useApi<Handover>(`/projects/${p.id}/handover`);
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"sign" | "view" | "close" | null>(null);
  const maintenanceHref = useMaintenanceHref();
  // Reload when the status moves (a crew member's last field asks for the signature).
  useEffect(() => {
    void reloadHandover();
  }, [p.status, reloadHandover]);
  if (!h) return null;

  async function act(path: string, json?: unknown): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetcher<{ message: string }>(`/projects/${p.id}/${path}`, { method: "POST", json });
      toast(res.message);
      await Promise.all([reload(), reloadHandover()]);
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Something went wrong.", "bad");
      if (err instanceof ApiError && err.status === 409) await reloadHandover();
      return false;
    } finally {
      setBusy(false);
    }
  }

  const a = h.actions;
  const signed = h.signature && T("Signed by {name} on {date}.", { name: h.signature.name, date: dt2s(h.signature.at) });
  const pdf = h.pdf && (
    <Button component="a" href={h.pdf} target="_blank" rel="noopener" variant="outlined" color="inherit" startIcon={<PictureAsPdfRoundedIcon />}>
      {T("Signed certificate (PDF)")}
    </Button>
  );
  const viewButton = (
    <Button variant="outlined" color="inherit" startIcon={<VerifiedRoundedIcon />} onClick={() => setDialog("view")}>
      {T("View certificate")}
    </Button>
  );

  let banner = null;
  if (h.status === "awaiting_signature" && a.sign) {
    banner = (
      <Alert severity="warning" icon={false} data-testid="handover-banner" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
        <AlertTitle sx={{ fontWeight: 600, fontSize: 16 }}>{T("Please sign your handover certificate")}</AlertTitle>
        {T("Your installation is complete. Check the installation certificate, then sign it here with your finger.")}
        <Button size="large" variant="contained" fullWidth startIcon={<DrawRoundedIcon />} disabled={busy} onClick={() => setDialog("sign")} sx={{ mt: 1.5 }}>
          {T("Review & sign")}
        </Button>
      </Alert>
    );
  } else if (h.status === "awaiting_signature") {
    banner = (
      <Alert severity="info" data-testid="handover-banner" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
        <AlertTitle sx={{ fontWeight: 600 }}>{T("Waiting for the homeowner's signature")}</AlertTitle>
        {T("{name} has been asked to sign the handover certificate.", { name: p.homeowner.name ?? T("The homeowner") })}
        <Stack direction="row" sx={{ gap: 1, mt: 1.5, flexWrap: "wrap" }}>
          {viewButton}
          {a.remind && (
            <Button variant="outlined" color="inherit" startIcon={<ReplayRoundedIcon />} disabled={busy} onClick={() => void act("handover/remind")}>
              {T("Send a reminder")}
            </Button>
          )}
        </Stack>
      </Alert>
    );
  } else if (h.status === "signed") {
    banner = (
      <Alert severity="success" data-testid="handover-banner" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
        <AlertTitle sx={{ fontWeight: 600 }}>{T("Handover certificate signed")}</AlertTitle>
        {signed}{" "}
        {a.close ? T("Check the certificate, then close the project.") : T("9 Solar Home will check it and close the project.")}
        <Stack direction="row" sx={{ gap: 1, mt: 1.5, flexWrap: "wrap" }}>
          {pdf}
          {a.close && (
            <Button variant="contained" startIcon={<TaskAltRoundedIcon />} disabled={busy} onClick={() => setDialog("close")}>
              {T("Close project")}
            </Button>
          )}
        </Stack>
      </Alert>
    );
  } else if (h.status === "closed") {
    banner = (
      <Alert severity="success" icon={<TaskAltRoundedIcon />} data-testid="handover-banner" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
        <AlertTitle sx={{ fontWeight: 600 }}>{T("Handed over")}</AlertTitle>
        {h.closed && (h.closed.by ? T("Closed on {date} by {name}.", { date: dt2s(h.closed.at), name: h.closed.by }) : T("Closed on {date}.", { date: dt2s(h.closed.at) }))} {signed}{" "}
        {h.maintenance ? T("The project is done; its system is now looked after on the Maintenance page.") : null}
        {(pdf || h.maintenance) && (
          <Stack direction="row" sx={{ gap: 1, mt: 1.5, flexWrap: "wrap" }}>
            {pdf}
            {h.maintenance ? (
              <Button variant="contained" component={Link} href={maintenanceHref(h.maintenance)} startIcon={<HandymanRoundedIcon />} data-testid="open-maintenance">
                {T("Open in Maintenance")}
              </Button>
            ) : null}
          </Stack>
        )}
      </Alert>
    );
  } else if (h.milestone3) {
    banner = (
      <Alert severity="success" data-testid="handover-banner" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
        <AlertTitle sx={{ fontWeight: 600 }}>{T("Ready for handover")}</AlertTitle>
        {a.request ? T("Every milestone is complete. Ask the homeowner to sign the handover certificate.") : T("Every milestone is complete. The homeowner will be asked to sign the handover certificate.")}
        {a.request && (
          <Stack direction="row" sx={{ gap: 1, mt: 1.5, flexWrap: "wrap" }}>
            {viewButton}
            <Button variant="contained" startIcon={<DrawRoundedIcon />} disabled={busy} onClick={() => void act("handover/request")}>
              {T("Ask for signature")}
            </Button>
          </Stack>
        )}
      </Alert>
    );
  }

  return (
    <>
      {banner}
      {dialog === "view" && (
        <MDialog title={T("Handover Certificate")} heading={h.certificate.title} subtitle={T("Certificate no. {number}", { number: h.certificate.number })} onClose={() => setDialog(null)}>
          <Certificate h={h} />
          <Button size="large" fullWidth onClick={() => setDialog(null)} sx={{ mt: 2 }}>
            {T("Done")}
          </Button>
        </MDialog>
      )}
      {dialog === "sign" && (
        <SignDialog
          h={h}
          busy={busy}
          onClose={() => setDialog(null)}
          onSign={async (body) => {
            if (await act("handover/sign", body)) setDialog(null);
          }}
        />
      )}
      {dialog === "close" && (
        <MDialog title={T("Close Project")} heading={T("Close {name}?", { name: p.name })} subtitle={T("Its development is done: it moves to the Maintenance page, where its system and checks are tracked. Everyone on the project, the admin team and the homeowner are told. This can't be undone.")} onClose={() => setDialog(null)} maxWidth="xs">
          <Stack sx={{ gap: 1, mt: 1 }}>
            <Button
              size="large"
              variant="contained"
              disabled={busy}
              data-testid="confirm-close"
              onClick={async () => {
                if (await act("close")) setDialog(null);
              }}
            >
              {T("Close project")}
            </Button>
            <Button size="large" onClick={() => setDialog(null)}>
              {T("Cancel")}
            </Button>
          </Stack>
        </MDialog>
      )}
    </>
  );
}

/** The certificate as the homeowner reads it: the same rows, in the same order, as the signed PDF. */
export function Certificate({ h }: { h: Handover }) {
  return (
    <Card variant="outlined" sx={{ px: 2, py: 1, mt: 1 }} data-testid="certificate">
      {h.certificate.rows.map(([label, value]) => (
        <Stack key={label} direction="row" sx={{ gap: 2, py: 0.9, borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } }}>
          <Typography variant="body2" sx={{ color: "text.secondary", flex: "0 0 42%", minWidth: 0 }}>
            {TR(label)}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
            {TR(value)}
          </Typography>
        </Stack>
      ))}
      <Typography variant="body2" sx={{ py: 1.25, lineHeight: 1.6 }}>
        {TR(h.certificate.statement)}
      </Typography>
    </Card>
  );
}

type SignBody = { fingerprint: string; signerName: string; signature: string; agree: boolean };

function SignDialog({ h, busy, onClose, onSign }: { h: Handover; busy: boolean; onClose: () => void; onSign: (b: SignBody) => Promise<void> }) {
  const me = useMe();
  const pad = useRef<SignaturePadHandle>(null);
  const [drawn, setDrawn] = useState(false);
  const [name, setName] = useState(me?.fullName ?? "");
  const [agree, setAgree] = useState(false);
  const ready = drawn && name.trim().length >= 2 && agree;
  return (
    <MDialog title={T("Handover Certificate")} heading={h.certificate.title} subtitle={T("Certificate no. {number}", { number: h.certificate.number })} onClose={onClose}>
      <Certificate h={h} />
      <Typography variant="subtitle2" sx={{ mt: 2.5, mb: 0.75, fontWeight: 600 }}>
        {T("Sign here")}
      </Typography>
      <SignaturePad ref={pad} onChange={setDrawn} />
      <Box sx={{ mt: 2 }}>
        <Field label={T("Your full name")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Box>
      <FormControlLabel
        sx={{ mt: 1.5, alignItems: "flex-start", "& .MuiCheckbox-root": { pt: 0.25 } }}
        control={<Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="agree" />}
        label={<Typography variant="body2">{T("I've read the certificate and accept the installation as complete.")}</Typography>}
      />
      <Stack sx={{ gap: 1, mt: 2 }}>
        <Button
          size="large"
          variant="contained"
          disabled={!ready || busy}
          data-testid="sign-certificate"
          onClick={() => void onSign({ fingerprint: h.fingerprint, signerName: name.trim(), signature: pad.current?.jpeg() ?? "", agree })}
        >
          {T("Sign certificate")}
        </Button>
        <Button size="large" onClick={onClose}>
          {T("Cancel")}
        </Button>
      </Stack>
    </MDialog>
  );
}

type SignaturePadHandle = { jpeg: () => string; clear: () => void };

/**
 * A signature drawn with a finger, mouse or pen. Saved as a JPEG on white,
 * which the server places in the PDF as it is. It only counts as signed once
 * there's a real stroke, not a tap.
 */
function SignaturePad({ ref, onChange }: { ref: Ref<SignaturePadHandle>; onChange: (drawn: boolean) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const length = useRef(0);

  const ctx = () => canvas.current?.getContext("2d") ?? null;
  const clear = () => {
    const c = canvas.current;
    const g = ctx();
    if (!c || !g) return;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    length.current = 0;
    onChange(false);
  };

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(c.clientWidth * ratio);
    c.height = Math.round(c.clientHeight * ratio);
    const g = c.getContext("2d");
    if (g) {
      g.scale(ratio, ratio);
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = 2.6;
      g.strokeStyle = "#111827";
    }
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({ jpeg: () => canvas.current?.toDataURL("image/jpeg", 0.85) ?? "", clear }));

  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <Box>
      <Box
        component="canvas"
        ref={canvas}
        data-testid="signature-pad"
        aria-label={T("Signature pad: draw your signature")}
        onPointerDown={(e: PointerEvent<HTMLCanvasElement>) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          last.current = at(e);
        }}
        onPointerMove={(e: PointerEvent<HTMLCanvasElement>) => {
          const g = ctx();
          if (!last.current || !g) return;
          const p = at(e);
          g.beginPath();
          g.moveTo(last.current.x, last.current.y);
          g.lineTo(p.x, p.y);
          g.stroke();
          length.current += Math.hypot(p.x - last.current.x, p.y - last.current.y);
          last.current = p;
          if (length.current > 40) onChange(true);
        }}
        onPointerUp={() => (last.current = null)}
        onPointerCancel={() => (last.current = null)}
        sx={{ display: "block", width: "100%", height: 170, borderRadius: 2, border: 2, borderStyle: "dashed", borderColor: "divider", bgcolor: "#ffffff", touchAction: "none", cursor: "crosshair" }}
      />
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mt: 0.5 }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {T("Use your finger, a pen or the mouse.")}
        </Typography>
        <Button size="small" onClick={clear}>
          {T("Clear")}
        </Button>
      </Stack>
    </Box>
  );
}
