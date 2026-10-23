"use client";

import AddPhotoAlternateRoundedIcon from "@mui/icons-material/AddPhotoAlternateRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type ReactNode, useMemo, useState } from "react";

import { Field, MDialog } from "@/components/m";
import { ApiError, useApi, useDownload, useFetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import {
  type Cell,
  dateText,
  type Invoice,
  invoiceWhat,
  lastMonth,
  money,
  monthlyAmount,
  monthName,
  monthShort,
  type Overview,
  readStatement,
  RESULT_LABEL,
  type Run,
  type Settings,
  STATE_LABEL,
  STATE_TONE,
  type StatementLine,
  toJpeg,
} from "@/lib/client/finance";
import { T, TR, useLang } from "@/lib/client/i18n";

const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

export function StateChip({ state, small }: { state: Cell["state"]; small?: boolean }) {
  return <Chip size={small ? "small" : "medium"} color={STATE_TONE[state] === "default" ? "default" : STATE_TONE[state]} variant={state === "paid" ? "filled" : "outlined"} label={TR(STATE_LABEL[state])} />;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2, rowGap: 0.25, py: 0.75, alignItems: "baseline", flexWrap: "wrap" }}>
      <Typography variant="body2" sx={{ color: "text.secondary", minWidth: 0, overflowWrap: "anywhere" }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 600, textAlign: "right", overflowWrap: "anywhere", minWidth: 0, ml: "auto" }}>
        {children}
      </Typography>
    </Stack>
  );
}

/** An invoice in a list: what it's for, its number, the amount (when shown) and its state. */
export function InvoiceRow({ inv, onOpen }: { inv: Invoice; onOpen: () => void }) {
  const { lang } = useLang();
  const [what, vars] = invoiceWhat(inv, lang);
  return (
    <Card sx={{ p: 0 }}>
      <ButtonBase onClick={onOpen} sx={{ width: "100%", textAlign: "left", p: 2, display: "flex", gap: 1.5, alignItems: "center" }} data-testid="invoice-row">
        <ReceiptLongRoundedIcon sx={{ color: "primary.main" }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 600 }}>
            {T(what, vars)}
          </Typography>
          <Typography noWrap variant="body2" sx={{ color: "text.secondary" }}>
            {inv.number} · {inv.billTo}
          </Typography>
          <Typography noWrap variant="caption" sx={{ color: "text.secondary" }}>
            {inv.status === "paid" ? T("Paid {date}", { date: dateText(inv.paidOn, lang) }) : T("Due {date}", { date: dateText(inv.dueOn, lang) })}
          </Typography>
        </Box>
        <Stack sx={{ alignItems: "flex-end", gap: 0.5, flexShrink: 0 }}>
          {inv.amount !== undefined && <Typography sx={{ fontWeight: 700 }}>{money(inv.amount)}</Typography>}
          <StateChip state={inv.state} small />
        </Stack>
      </ButtonBase>
    </Card>
  );
}

async function uploadTo(fetcher: ReturnType<typeof useFetcher>, linkPath: string, blob: Blob, type: string): Promise<string> {
  const link = await fetcher<{ key: string; uploadUrl: string; headers: Record<string, string> }>(linkPath, { method: "POST", json: { contentType: type, size: blob.size } });
  const put = await fetch(link.uploadUrl, { method: "PUT", body: blob, headers: link.headers });
  if (!put.ok) throw new Error(T("The upload didn't go through. Please try again."));
  return link.key;
}

/**
 * One invoice, receipt style: what it's for, the amounts, how it was paid.
 * Admin marks it paid or voids it; its homeowner pays with the QR and can
 * attach proof. Both download the PDF.
 */
export function InvoiceDialog({ id, admin, qr, payNote, onClose, onChanged }: { id: number; admin: boolean; qr?: string | null; payNote?: string; onClose: () => void; onChanged: () => void | Promise<void> }) {
  const fetcher = useFetcher();
  const download = useDownload();
  const { toast } = useApp();
  const { lang } = useLang();
  const { data: inv, reload } = useApi<Invoice>(`/invoices/${id}`);
  const [mode, setMode] = useState<"view" | "paid" | "void">("view");
  const [paidOn, setPaidOn] = useState(today());
  const [typed, setAmount] = useState<string | null>(null);
  const amount = typed ?? inv?.amount ?? "";
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (path: string, json: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetcher<{ message: string }>(path, { method: "POST", json });
      toast(r.message);
      setMode("view");
      await reload();
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const attach = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const key = await uploadTo(fetcher, `/invoices/${id}/proof/upload-link`, file, file.type);
      const r = await fetcher<{ message: string }>(`/invoices/${id}/proof`, { method: "POST", json: { key } });
      toast(r.message);
      await reload();
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const [what, vars] = inv ? invoiceWhat(inv, lang) : ["", {}];
  return (
    <MDialog title={T("Invoice")} heading={inv ? T(what, vars) : undefined} subtitle={inv?.number} onClose={onClose}>
      {!inv ? (
        <Skeleton variant="rounded" height={260} />
      ) : (
        <Stack sx={{ gap: 2 }} data-testid="invoice-dialog">
          {inv.status === "paid" && (
            <Stack sx={{ alignItems: "center", gap: 0.5, py: 1 }}>
              <CheckCircleRoundedIcon sx={{ fontSize: 48, color: "success.main" }} />
              <Typography sx={{ fontWeight: 700, fontSize: 18 }}>{T("Payment received")}</Typography>
            </Stack>
          )}
          <Card sx={{ p: 2 }}>
            <Typography variant="overline" sx={{ color: "text.secondary" }}>
              {T("Payment details")}
            </Typography>
            <Row label={T("Invoice number")}>{inv.number}</Row>
            <Row label={T("Billed to")}>{inv.billTo}</Row>
            <Row label={T("Issued")}>{dateText(inv.issuedOn, lang)}</Row>
            <Row label={T("Due")}>{dateText(inv.dueOn, lang)}</Row>
            <Row label={T("Status")}>
              <StateChip state={inv.state} small />
            </Row>
            {inv.paidOn && <Row label={T("Paid on")}>{dateText(inv.paidOn, lang)}</Row>}
            {inv.paidVia && <Row label={T("How it was confirmed")}>{inv.paidVia === "statement" ? T("Bank statement") : T("By Admin")}</Row>}
            {inv.voidReason && <Row label={T("Why it was voided")}>{inv.voidReason}</Row>}
            {inv.amount !== undefined && (
              <>
                <Divider sx={{ my: 1 }} />
                {inv.kind === "monthly" && inv.kwh && (
                  <Row label={T("Generated")}>
                    {inv.kwh} kWh × S${inv.rate}
                  </Row>
                )}
                <Row label={T("Amount")}>
                  <Box component="span" sx={{ fontSize: 18, color: "primary.main" }}>
                    {money(inv.amount)}
                  </Box>
                </Row>
                {inv.paidAmount && inv.paidAmount !== inv.amount && <Row label={T("Paid")}>{money(inv.paidAmount)}</Row>}
              </>
            )}
          </Card>

          {!admin && inv.status === "issued" && (
            <Card sx={{ p: 2 }} data-testid="pay-with-qr">
              <Typography sx={{ fontWeight: 700, mb: 1 }}>{T("How to pay")}</Typography>
              {qr ? (
                <Box component="img" src={qr} alt={T("Payment QR code")} sx={{ width: "100%", maxWidth: 240, aspectRatio: "1", objectFit: "contain", display: "block", mx: "auto", bgcolor: "#fff", borderRadius: 2, p: 1 }} />
              ) : (
                <Alert severity="info" icon={<QrCode2RoundedIcon />}>
                  {T("The payment QR isn't set up yet. Contact 9 Solar Home to pay.")}
                </Alert>
              )}
              {payNote && (
                <Typography variant="body2" sx={{ mt: 1.5 }}>
                  {payNote}
                </Typography>
              )}
              <Typography variant="body2" sx={{ mt: 1, fontWeight: 700 }}>
                {T("Reference: {number}", { number: inv.number })}
              </Typography>
              <Button component="label" variant="outlined" size="large" fullWidth startIcon={<AddPhotoAlternateRoundedIcon />} disabled={busy} sx={{ mt: 2 }} data-testid="attach-proof">
                {inv.hasProof ? T("Send another proof of payment") : T("I've paid: send proof")}
                <input hidden type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => e.target.files?.[0] && void attach(e.target.files[0])} />
              </Button>
              {inv.hasProof && (
                <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 1 }}>
                  {T("Proof sent. Admin will confirm the payment here.")}
                </Typography>
              )}
            </Card>
          )}

          {admin && mode === "paid" && (
            <Card sx={{ p: 2 }}>
              <Stack sx={{ gap: 2 }}>
                <Field label={T("Paid on")} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} slotProps={{ htmlInput: { max: today(), "data-testid": "paid-on" } }} />
                <Field label={T("Amount received (S$)")} value={amount} onChange={(e) => setAmount(e.target.value)} slotProps={{ htmlInput: { inputMode: "decimal", "data-testid": "paid-amount" } }} />
                <Field label={T("Bank reference (optional)")} value={ref} onChange={(e) => setRef(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
                <Button variant="contained" size="large" disabled={busy} onClick={() => void act(`/finance/invoices/${id}/paid`, { paidOn, amount, ref })} data-testid="confirm-paid">
                  {T("Mark paid")}
                </Button>
              </Stack>
            </Card>
          )}
          {admin && mode === "void" && (
            <Card sx={{ p: 2 }}>
              <Stack sx={{ gap: 2 }}>
                <Field label={T("Why it's voided")} value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 300 } }} />
                <Button variant="contained" color="error" size="large" disabled={busy} onClick={() => void act(`/finance/invoices/${id}/void`, { reason })} data-testid="confirm-void">
                  {T("Void the invoice")}
                </Button>
              </Stack>
            </Card>
          )}
          {error && <Alert severity="error">{error}</Alert>}

          <Stack sx={{ gap: 1 }}>
            <Button variant={admin && inv.status === "issued" ? "outlined" : "contained"} size="large" startIcon={<DownloadRoundedIcon />} onClick={() => void download(`/invoices/${id}/pdf`, `${inv.number}.pdf`).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))} data-testid="invoice-pdf">
              {inv.status === "paid" ? T("Download PDF receipt") : T("Download PDF")}
            </Button>
            {admin && inv.hasProof && (
              <Button variant="outlined" size="large" startIcon={<UploadFileRoundedIcon />} href={`/api/py/invoices/${id}/proof`} target="_blank" rel="noopener noreferrer">
                {T("See the proof they sent")}
              </Button>
            )}
            {admin && inv.status === "issued" && mode === "view" && (
              <>
                <Button variant="contained" size="large" onClick={() => setMode("paid")} data-testid="mark-paid">
                  {T("Mark paid")}
                </Button>
                <Button color="error" size="large" onClick={() => setMode("void")} data-testid="void-invoice">
                  {T("Void")}
                </Button>
              </>
            )}
          </Stack>
        </Stack>
      )}
    </MDialog>
  );
}

// ------------------------------------------------------------------ the overview

function MonthCell({ cell, month, onOpen }: { cell: Cell; month: string; onOpen?: (id: number) => void }) {
  const { lang } = useLang();
  const tone = STATE_TONE[cell.state];
  const colour = tone === "default" ? "text.disabled" : `${tone}.main`;
  const body = (
    <Stack sx={{ alignItems: "center", gap: 0.25, py: 0.5, width: "100%" }}>
      <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.2 }}>
        {monthShort(month, lang)}
      </Typography>
      <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: cell.state === "none" || cell.state === "later" ? "transparent" : colour, border: 2, borderColor: colour }} />
    </Stack>
  );
  const label = `${monthName(month, lang)}: ${TR(STATE_LABEL[cell.state])}${cell.amount ? `, ${money(cell.amount)}` : ""}`;
  return cell.id && onOpen ? (
    <ButtonBase aria-label={label} title={label} onClick={() => onOpen(cell.id!)} sx={{ borderRadius: 1 }}>
      {body}
    </ButtonBase>
  ) : (
    <Box aria-label={label} title={label}>
      {body}
    </Box>
  );
}

/** Each project's admin fee, or each system's twelve months: issued? paid? (Amounts only for Admin.) */
export function StatusBoard({ data, show, onOpen, onIssueFee, busyFee }: { data: Overview; show: "fees" | "monthly"; onOpen?: (id: number) => void; onIssueFee?: (projectId: number) => void; busyFee?: number | null }) {
  const legend: Cell["state"][] = ["paid", "waiting", "overdue", "to_issue"];
  const fees = data.projects.filter((p) => p.status !== "maintenance" || p.fee.state !== "to_issue");
  return (
    <Stack sx={{ gap: 2.5 }}>
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        {legend.map((s) => (
          <StateChip key={s} state={s} small />
        ))}
      </Stack>
      {show === "fees" && fees.length === 0 && (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {T("No admin fees yet. Each project has one, paid before it moves to Maintenance.")}
        </Typography>
      )}
      {show === "fees" && fees.length > 0 && (
        <Box>
          <Typography sx={{ fontWeight: 700, mb: 1 }}>{T("Admin fee")}</Typography>
          <Stack sx={{ gap: 1 }}>
            {fees.map((p) => (
              <Card key={p.id} sx={{ p: 1.5 }} data-testid="fee-row">
                <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
                  <Box sx={{ flex: "1 1 160px", minWidth: 0 }}>
                    <Typography noWrap sx={{ fontWeight: 600 }}>
                      {p.name}
                    </Typography>
                    <Typography noWrap variant="body2" sx={{ color: "text.secondary" }}>
                      {[p.code, p.homeowner].filter(Boolean).join(" · ")}
                    </Typography>
                  </Box>
                  {p.fee.amount && <Typography sx={{ fontWeight: 700 }}>{money(p.fee.amount)}</Typography>}
                  {p.fee.id && onOpen ? (
                    <ButtonBase onClick={() => onOpen(p.fee.id!)} sx={{ borderRadius: 4 }}>
                      <StateChip state={p.fee.state} small />
                    </ButtonBase>
                  ) : (
                    <StateChip state={p.fee.state} small />
                  )}
                  {onIssueFee && p.fee.state === "to_issue" && (
                    <Button size="small" variant="outlined" disabled={busyFee === p.id} onClick={() => onIssueFee(p.id)} data-testid="issue-fee">
                      {T("Issue")}
                    </Button>
                  )}
                </Stack>
              </Card>
            ))}
          </Stack>
        </Box>
      )}
      {show === "monthly" && (
        <Box>
          <Typography sx={{ fontWeight: 700, mb: 1 }}>{T("Monthly payments, {year}", { year: String(data.year) })}</Typography>
        {data.systems.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {T("No systems are billed yet. A system is billed monthly from the month it's turned on.")}
          </Typography>
        ) : (
          <Stack sx={{ gap: 1 }}>
            {data.systems.map((s) => (
              <Card key={s.id} sx={{ p: 1.5 }} data-testid="system-months">
                <Typography noWrap sx={{ fontWeight: 600 }}>
                  {s.name ?? s.address}
                </Typography>
                <Typography noWrap variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                  {[s.code, s.address, s.rate ? `S$${s.rate}/kWh` : null].filter(Boolean).join(" · ")}
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(auto-fill, minmax(2.75rem, 1fr))", sm: "repeat(12, minmax(0, 1fr))" }, gap: 0.5 }}>
                  {s.months.map((c, i) => (
                    <MonthCell key={data.months[i]} cell={c} month={data.months[i]} onOpen={onOpen} />
                  ))}
                </Box>
              </Card>
            ))}
          </Stack>
        )}
        </Box>
      )}
    </Stack>
  );
}

// ------------------------------------------------------------------ issuing a month

export function IssuePanel({ onIssued }: { onIssued: () => void | Promise<void> }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const { lang } = useLang();
  const [month, setMonth] = useState(lastMonth(today()));
  const { data, error, reload } = useApi<Run>(/^\d{4}-\d{2}$/.test(month) ? `/finance/run?month=${month}` : null);
  // What's typed for each system this month, over what its recorded output says; and those left out.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const kwh: Record<number, string> = Object.fromEntries((data?.rows ?? []).map((r) => [r.systemId, typed[`${month}:${r.systemId}`] ?? r.kwh ?? ""]));
  const skip = new Set((data?.rows ?? []).filter((r) => skipped.has(`${month}:${r.systemId}`)).map((r) => r.systemId));
  const setKwh = (id: number, v: string) => setTyped((t) => ({ ...t, [`${month}:${id}`]: v }));
  const setSkip = (id: number, out: boolean) =>
    setSkipped((s) => {
      const n = new Set(s);
      if (out) n.add(`${month}:${id}`);
      else n.delete(`${month}:${id}`);
      return n;
    });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const open = (data?.rows ?? []).filter((r) => !r.invoice && !r.problem);
  const chosen = open.filter((r) => !skip.has(r.systemId) && monthlyAmount(kwh[r.systemId] ?? "", r.rate ?? "") !== null);
  const total = chosen.reduce((n, r) => n + Number(monthlyAmount(kwh[r.systemId], r.rate ?? "0")), 0);

  const issue = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await fetcher<{ message: string }>("/finance/run", { method: "POST", json: { month, items: chosen.map((x) => ({ systemId: x.systemId, kwh: kwh[x.systemId] })) } });
      toast(r.message);
      setTyped({});
      await reload();
      await onIssued();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack sx={{ gap: 2 }}>
      <Field label={T("Month")} type="month" value={month} onChange={(e) => setMonth(e.target.value)} helperText={T("Invoice a month once it's over: the kWh each system generated times its rate.")} slotProps={{ htmlInput: { max: lastMonth(today()), "data-testid": "run-month" } }} />
      {error && <Alert severity="error">{error.message}</Alert>}
      {!data && !error && <Skeleton variant="rounded" height={160} />}
      {data && data.rows.length === 0 && (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {T("No system is billed for {month}.", { month: monthName(data.month, lang) })}
        </Typography>
      )}
      {data?.rows.map((r) => {
        const amount = monthlyAmount(kwh[r.systemId] ?? "", r.rate ?? "");
        return (
          <Card key={r.systemId} sx={{ p: 1.5 }} data-testid="run-row">
            <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
              {!r.invoice && !r.problem && (
                <Checkbox checked={!skip.has(r.systemId)} onChange={(e) => setSkip(r.systemId, !e.target.checked)} slotProps={{ input: { "aria-label": T("Include") } }} />
              )}
              <Box sx={{ flex: "1 1 150px", minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 600 }}>
                  {r.name ?? r.address}
                </Typography>
                <Typography noWrap variant="body2" sx={{ color: "text.secondary" }}>
                  {[r.code, r.rate ? `S$${r.rate}/kWh` : null].filter(Boolean).join(" · ")}
                </Typography>
              </Box>
              {r.invoice ? (
                <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                  <Typography variant="body2">{r.invoice.number}</Typography>
                  <StateChip state={r.invoice.state} small />
                </Stack>
              ) : r.problem ? (
                <Typography variant="body2" sx={{ color: "warning.main" }}>
                  {TR(r.problem)}
                </Typography>
              ) : (
                <Stack direction="row" sx={{ gap: 1, alignItems: "center", flex: "0 1 220px", flexWrap: "wrap", maxWidth: "100%" }}>
                  <TextField size="small" label="kWh" value={kwh[r.systemId] ?? ""} onChange={(e) => setKwh(r.systemId, e.target.value)} slotProps={{ htmlInput: { inputMode: "decimal", "data-testid": "run-kwh" } }} sx={{ width: 110, maxWidth: "100%" }} />
                  <Typography sx={{ fontWeight: 700, minWidth: 0 }}>{amount ? money(amount) : "—"}</Typography>
                </Stack>
              )}
            </Stack>
          </Card>
        );
      })}
      {problem && <Alert severity="error">{problem}</Alert>}
      {open.length > 0 && (
        <Button variant="contained" size="large" disabled={busy || chosen.length === 0} onClick={() => void issue()} data-testid="issue-month">
          {T("Issue {n} invoices · {total}", { n: String(chosen.length), total: money(total.toFixed(2)) })}
        </Button>
      )}
    </Stack>
  );
}

// ------------------------------------------------------------------ the bank's statement

export function StatementPanel({ onConfirmed }: { onConfirmed: () => void | Promise<void> }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const { lang } = useLang();
  const [res, setRes] = useState<{ id: number; lines: StatementLine[] } | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const text = await readStatement(file);
      const r = await fetcher<{ id: number; lines: StatementLine[] }>("/finance/statements", { method: "POST", json: { fileName: file.name, text } });
      setRes(r);
      setChosen(new Set(r.lines.map((l, i) => (l.result === "match" ? i : -1)).filter((i) => i >= 0)));
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!res) return;
    setBusy(true);
    try {
      const r = await fetcher<{ message: string }>(`/finance/statements/${res.id}/confirm`, { method: "POST", json: { lines: [...chosen] } });
      toast(r.message);
      setRes(null);
      await onConfirmed();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack sx={{ gap: 2 }}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {T("Export the account's statement from your bank as CSV and upload it. Each payment that carries an invoice number as its reference is matched to that invoice; you confirm which to mark paid.")}
      </Typography>
      <Button component="label" variant="outlined" size="large" startIcon={<UploadFileRoundedIcon />} disabled={busy} data-testid="statement-upload" sx={{ whiteSpace: "normal", textAlign: "center" }}>
        {T("Upload a bank statement (CSV)")}
        <input hidden type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
      </Button>
      {error && <Alert severity="error">{error}</Alert>}
      {res && (
        <>
          {res.lines.map((l, i) => (
            <Card key={i} sx={{ p: 1.5 }} data-testid="statement-line">
              <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                {(l.result === "match" || l.result === "amount differs") && (
                  <Checkbox checked={chosen.has(i)} onChange={(e) => setChosen((s) => { const n = new Set(s); if (e.target.checked) n.add(i); else n.delete(i); return n; })} slotProps={{ input: { "aria-label": T("Mark this invoice paid") } }} />
                )}
                <Box sx={{ flex: "1 1 160px", minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {money(l.amount)} · {dateText(l.date, lang)}
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary", overflowWrap: "anywhere" }}>
                    {l.words || "—"}
                  </Typography>
                </Box>
                <Stack sx={{ alignItems: "flex-end", gap: 0.5 }}>
                  {l.number && <Typography variant="body2">{l.number}</Typography>}
                  <Chip size="small" variant="outlined" color={l.result === "match" ? "success" : l.result === "amount differs" ? "warning" : "default"} label={TR(RESULT_LABEL[l.result])} />
                </Stack>
              </Stack>
            </Card>
          ))}
          <Button variant="contained" size="large" disabled={busy || chosen.size === 0} onClick={() => void confirm()} data-testid="statement-confirm">
            {T("Mark {n} invoices paid", { n: String(chosen.size) })}
          </Button>
        </>
      )}
    </Stack>
  );
}

// ------------------------------------------------------------------ designing the invoice

/** The invoice as the PDF lays it out, live, with sample figures. */
export function InvoicePreview({ s }: { s: Settings }) {
  const sample = { number: "INV-2026-00042", kwh: "812.40", rate: "0.2650" };
  const amount = monthlyAmount(sample.kwh, sample.rate) ?? "0";
  const grey = "#6b6b72";
  return (
    <Box sx={{ bgcolor: "#fff", color: "#1a1a1f", borderRadius: 2, overflow: "hidden", boxShadow: 3, fontSize: 12, maxWidth: 520, mx: "auto", width: "100%" }} data-testid="invoice-preview">
      <Box sx={{ bgcolor: s.accent, color: "#fff", p: 2, display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
        {s.show.logo && s.logo && <Box component="img" src={s.logo} alt="" sx={{ height: 40, maxWidth: 110, objectFit: "contain", bgcolor: "#fff", borderRadius: 1, p: 0.25 }} />}
        <Box sx={{ flex: "1 1 160px", minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 15, color: "#fff" }}>{s.companyName}</Typography>
          <Typography sx={{ fontSize: 10.5, opacity: 0.9, color: "#fff", whiteSpace: "pre-line" }}>
            {[s.companyAddress?.split("\n").join(", "), s.show.uen && s.companyUen ? `UEN ${s.companyUen}` : null, [s.companyEmail, s.companyPhone].filter(Boolean).join("  |  ")].filter(Boolean).join("\n")}
          </Typography>
        </Box>
        <Typography sx={{ fontWeight: 800, fontSize: 20, color: "#fff" }}>{s.invoiceTitle}</Typography>
      </Box>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
          <Box>
            <Typography sx={{ fontSize: 9, fontWeight: 700, color: grey }}>BILLED TO</Typography>
            <Typography sx={{ fontWeight: 700 }}>Mr Tan Ah Kow</Typography>
            <Typography sx={{ fontSize: 11, color: grey }}>7 Example Avenue, Singapore 466001</Typography>
          </Box>
          <Box sx={{ textAlign: "right" }}>
            <Typography sx={{ fontSize: 11 }}>
              <b>{sample.number}</b>
            </Typography>
            <Typography sx={{ fontSize: 11, color: grey }}>Due in {s.dueDays} days</Typography>
          </Box>
        </Stack>
        {s.intro && <Typography sx={{ fontSize: 11, mt: 1.5, whiteSpace: "pre-line" }}>{s.intro}</Typography>}
        {/* One grid for the heading and the line, so the columns line up: the figures take what they need,
            the description the rest, wrapping (large text on a narrow phone). */}
        <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: s.show.kwh ? "minmax(0, 1fr) auto auto" : "minmax(0, 1fr) auto", columnGap: 1, "& > *": { px: 0.5 } }}>
          <Box sx={{ bgcolor: "#eef2f0", py: 0.75, fontSize: 9, fontWeight: 700, color: grey, minWidth: 0, overflowWrap: "anywhere" }}>DESCRIPTION</Box>
          {s.show.kwh && <Box sx={{ bgcolor: "#eef2f0", py: 0.75, fontSize: 9, fontWeight: 700, color: grey, textAlign: "right" }}>KWH</Box>}
          <Box sx={{ bgcolor: "#eef2f0", py: 0.75, fontSize: 9, fontWeight: 700, color: grey, textAlign: "right" }}>AMOUNT</Box>
          <Box sx={{ py: 1, borderBottom: "1px solid #ddd", minWidth: 0, overflowWrap: "anywhere", fontWeight: 700 }}>Solar power generated, October 2026</Box>
          {s.show.kwh && <Box sx={{ py: 1, borderBottom: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>{sample.kwh}</Box>}
          <Box sx={{ py: 1, borderBottom: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>{money(amount)}</Box>
        </Box>
        <Stack direction="row" sx={{ justifyContent: "flex-end", gap: 2, rowGap: 0, mt: 1, alignItems: "baseline", flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: grey }}>TOTAL DUE</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: 16, color: s.accent }}>{money(amount)}</Typography>
        </Stack>
        <Stack direction="row" sx={{ gap: 1.5, mt: 1.5, alignItems: "flex-start" }}>
          {s.show.qr && (s.qr ? <Box component="img" src={s.qr} alt="" sx={{ width: 72, height: 72, objectFit: "contain" }} /> : <QrCode2RoundedIcon sx={{ fontSize: 72, color: "#bbb" }} />)}
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 9, fontWeight: 700, color: grey }}>HOW TO PAY</Typography>
            <Typography sx={{ fontSize: 11 }}>{s.payNote}</Typography>
            <Typography sx={{ fontSize: 11, fontWeight: 700 }}>Reference: {sample.number}</Typography>
          </Box>
        </Stack>
        {s.show.terms && s.terms && (
          <Typography sx={{ fontSize: 10, color: grey, mt: 1.5, whiteSpace: "pre-line" }}>
            <b>TERMS</b>
            {"\n"}
            {s.terms}
          </Typography>
        )}
        {s.footer && <Typography sx={{ fontSize: 10, color: grey, mt: 1.5, textAlign: "center", borderTop: `2px solid ${s.accent}`, pt: 1 }}>{s.footer}</Typography>}
      </Box>
    </Box>
  );
}

const SHOW_LABEL: Record<keyof Settings["show"], string> = { logo: "Logo", qr: "Payment QR", uen: "UEN", kwh: "kWh and rate", terms: "Terms" };

/** The invoice's design, the company's details, the QR and the fee: edited here, previewed live, used by every new PDF. */
export function DesignPanel() {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const { data, error, reload } = useApi<Settings>("/finance/settings");
  // What's been changed, over what's saved.
  const [edits, setEdits] = useState<Partial<Settings>>({});
  const s: Settings | null = data ? { ...data, ...edits } : null;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => setEdits((x) => ({ ...x, [k]: v }));
  const changed = useMemo(() => Object.keys(edits).length > 0, [edits]);

  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (!s) return <Skeleton variant="rounded" height={320} />;

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { logo: _l, qr: _q, planYears: _p, ...body } = s;
      const r = await fetcher<{ message: string }>("/finance/settings", { method: "PUT", json: body });
      toast(r.message);
      await reload();
      setEdits({});
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };
  const picture = async (which: "logo" | "qr", file: File) => {
    setBusy(true);
    setProblem(null);
    try {
      const jpeg = await toJpeg(file);
      const key = await uploadTo(fetcher, `/finance/settings/${which}/upload-link`, jpeg, "image/jpeg");
      const r = await fetcher<{ message: string }>(`/finance/settings/${which}`, { method: "POST", json: { key } });
      toast(r.message);
      await reload();
    } catch (e) {
      setProblem(e instanceof ApiError || e instanceof Error ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const text = (k: "companyName" | "companyAddress" | "companyUen" | "companyEmail" | "companyPhone" | "invoiceTitle" | "intro" | "payNote" | "terms" | "footer", label: string, rows = 0) => (
    <Field label={label} value={s[k] ?? ""} onChange={(e) => set(k)(e.target.value)} multiline={rows > 0} minRows={rows || undefined} />
  );
  return (
    <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1fr) minmax(0, 1fr)" }, alignItems: "start" }} data-testid="invoice-design">
      <Stack sx={{ gap: 2 }}>
        <Typography sx={{ fontWeight: 700 }}>{T("Company")}</Typography>
        {text("companyName", T("Company name"))}
        {text("companyAddress", T("Address"), 2)}
        <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 2 }}>
          {text("companyUen", T("UEN"))}
          {text("companyPhone", T("Phone"))}
        </Stack>
        {text("companyEmail", T("Email"))}
        <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 1 }}>
          <Button component="label" variant="outlined" size="large" disabled={busy} sx={{ flex: 1 }} data-testid="upload-logo">
            {s.logo ? T("Change the logo") : T("Upload the logo")}
            <input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && void picture("logo", e.target.files[0])} />
          </Button>
          <Button component="label" variant="outlined" size="large" startIcon={<QrCode2RoundedIcon />} disabled={busy} sx={{ flex: 1 }} data-testid="upload-qr">
            {s.qr ? T("Change the payment QR") : T("Upload the payment QR")}
            <input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && void picture("qr", e.target.files[0])} />
          </Button>
        </Stack>
        <Typography sx={{ fontWeight: 700, mt: 1 }}>{T("Invoice")}</Typography>
        {text("invoiceTitle", T("Title"))}
        <Stack direction="row" sx={{ gap: 2, alignItems: "center" }}>
          <Field label={T("Colour")} type="color" value={s.accent} onChange={(e) => set("accent")(e.target.value.toUpperCase())} sx={{ width: 120 }} slotProps={{ htmlInput: { "data-testid": "invoice-colour" } }} />
          <Field label={T("Days to pay")} type="number" value={String(s.dueDays)} onChange={(e) => set("dueDays")(Math.max(0, Math.min(90, Number(e.target.value) || 0)))} sx={{ width: 140 }} slotProps={{ htmlInput: { min: 0, max: 90 } }} />
        </Stack>
        {text("intro", T("Opening words (optional)"), 2)}
        {text("payNote", T("How to pay"), 2)}
        {text("terms", T("Terms (optional)"), 3)}
        {text("footer", T("Footer (optional)"))}
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {T("Show on the invoice")}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2 }}>
            {(Object.keys(SHOW_LABEL) as Array<keyof Settings["show"]>).map((k) => (
              <FormControlLabel key={k} control={<Switch checked={s.show[k]} onChange={(e) => set("show")({ ...s.show, [k]: e.target.checked })} />} label={T(SHOW_LABEL[k])} />
            ))}
          </Stack>
        </Box>
        <Typography sx={{ fontWeight: 700, mt: 1 }}>{T("The plan")}</Typography>
        <Field label={T("Admin fee (S$), paid before the handover")} value={s.adminFee} onChange={(e) => set("adminFee")(e.target.value)} slotProps={{ htmlInput: { inputMode: "decimal", "data-testid": "admin-fee" } }} helperText={T("Then monthly, for {n} years from the month the system is turned on: the kWh it generated times its contract's rate.", { n: String(s.planYears) })} />
        {problem && <Alert severity="error">{problem}</Alert>}
        <Button variant="contained" size="large" disabled={busy || !changed} onClick={() => void save()} data-testid="save-design">
          {T("Save")}
        </Button>
      </Stack>
      <Box sx={{ position: { lg: "sticky" }, top: { lg: 16 } }}>
        <Typography sx={{ fontWeight: 700, mb: 1 }}>{T("Preview")}</Typography>
        <InvoicePreview s={s} />
      </Box>
    </Box>
  );
}

// ------------------------------------------------------------------ on a project's page

type ProjectPay = { fee: Invoice | null; feePaid: boolean; months: Invoice[] };

/** A project's admin fee and its system's recent months: amounts for its homeowner and Admin, statuses for its manager. */
export function ProjectPayments({ pid, onOpen }: { pid: number; onOpen?: (id: number) => void }) {
  const { lang } = useLang();
  const { data } = useApi<ProjectPay>(`/projects/${pid}/payments`);
  if (!data) return null;
  return (
    <Card sx={{ p: 2 }} data-testid="project-payments">
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 1 }}>
        <ReceiptLongRoundedIcon sx={{ color: "primary.main" }} />
        <Typography sx={{ fontWeight: 700, flex: 1 }}>{T("Payments")}</Typography>
      </Stack>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, py: 0.5, flexWrap: "wrap" }}>
        <Typography variant="body2" sx={{ flex: "1 1 120px" }}>
          {T("Admin fee")}
          {data.fee?.amount ? ` · ${money(data.fee.amount)}` : ""}
        </Typography>
        {data.fee && onOpen ? (
          <ButtonBase onClick={() => onOpen(data.fee!.id)} sx={{ borderRadius: 4 }}>
            <StateChip state={data.fee.state} small />
          </ButtonBase>
        ) : (
          <StateChip state={data.fee ? data.fee.state : "to_issue"} small />
        )}
      </Stack>
      {!data.feePaid && (
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
          {T("Paid before the project moves to Maintenance.")}
        </Typography>
      )}
      {data.months.length > 0 && <Divider sx={{ my: 1 }} />}
      {data.months.slice(0, 6).map((m) => (
        <Stack key={m.id} direction="row" sx={{ alignItems: "center", gap: 1, py: 0.5, flexWrap: "wrap" }}>
          <Typography variant="body2" sx={{ flex: "1 1 120px" }}>
            {monthName(m.period ?? "", lang)}
            {m.amount ? ` · ${money(m.amount)}` : ""}
          </Typography>
          {onOpen ? (
            <ButtonBase onClick={() => onOpen(m.id)} sx={{ borderRadius: 4 }}>
              <StateChip state={m.state} small />
            </ButtonBase>
          ) : (
            <StateChip state={m.state} small />
          )}
        </Stack>
      ))}
    </Card>
  );
}
