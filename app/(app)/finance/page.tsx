"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import FileDownloadRoundedIcon from "@mui/icons-material/FileDownloadRounded";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { DesignPanel, FeeIssueDialog, InvoiceDialog, InvoiceRow, IssuePanel, StatementPanel, StatusBoard } from "@/components/finance";
import { Page } from "@/components/shell";
import { GRID, SegTabs, TopBar } from "@/components/topbar";
import { ApiError, useApi, useDownload } from "@/lib/client/api";
import { handlesPayments, useApp, useMe } from "@/lib/client/app-state";
import { type Invoice, money, type Overview, STATE_LABEL } from "@/lib/client/finance";
import { T } from "@/lib/client/i18n";
import { useTab } from "@/lib/client/tabs";

// The admin fee and the monthly payments are a tab each (the user, 19 Oct 2026).
type Tab = "fees" | "monthly" | "invoices" | "issue" | "statement" | "design";
const ADMIN_TABS: Tab[] = ["fees", "monthly", "invoices", "issue", "statement", "design"];
const PM_TABS: Tab[] = ["fees", "monthly"];
type Filter = "all" | "issued" | "overdue" | "proof" | "paid" | "void";
const FILTERS: Filter[] = ["all", "issued", "overdue", "proof", "paid", "void"];

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card sx={{ p: 2 }}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 800, fontSize: 22, color: tone ?? "text.primary" }} data-fit>
        {value}
      </Typography>
    </Card>
  );
}

/**
 * Payments. Admin (finance) and superadmins: the year at a glance (each
 * project's admin fee, each system's months), every invoice, issuing a
 * month's invoices, matching the bank's statement, and the invoice's design.
 * Project managers: whether each month was issued and paid, for the projects
 * and systems they run; no amounts.
 */
function FinanceScreen() {
  const me = useMe();
  const download = useDownload();
  const { toast } = useApp();
  const admin = handlesPayments(me?.role);
  const [tab, setTab] = useTab<Tab>(ADMIN_TABS, "fees");
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, error, reload } = useApi<Overview>(me ? `/finance/overview?year=${year}` : null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const list = useApi<{ invoices: Invoice[] }>(admin && tab === "invoices" ? `/finance/invoices?status=${filter === "all" ? "" : filter}&q=${encodeURIComponent(q)}` : null);
  // Opened from an alert: /finance?invoice=12.
  const params = useSearchParams();
  const [open, setOpen] = useState<number | null>(() => Number(params.get("invoice")) || null);
  // The check before admin fees are issued: one project's (from its row), or every one still to invoice.
  const [feeCheck, setFeeCheck] = useState<{ only: number | null } | null>(null);


  if (!me) return null;
  const tabs = admin ? ADMIN_TABS : PM_TABS;
  const shownTab: Tab = tabs.includes(tab) ? tab : "fees";
  const board = shownTab === "fees" || shownTab === "monthly" ? shownTab : null;
  const labels: Record<Tab, string> = { fees: "Admin fee", monthly: "Monthly", invoices: "Invoices", issue: "Issue a month", statement: "Bank statement", design: "Invoice design" };
  const filterLabels: Record<Filter, string> = { all: "All", issued: "Unpaid", overdue: "Overdue", proof: "Proof sent", paid: "Paid", void: "Void" };
  const again = async () => {
    await reload();
    await list.reload();
  };
  // The invoices as listed (this filter and search), one row each.
  const invoicesToExcel = async () => {
    const rows = (list.data?.invoices ?? []).map((i) => [
      i.number,
      i.kind === "admin_fee" ? T("Admin fee") : T("Monthly"),
      T(STATE_LABEL[i.state]),
      i.billTo,
      i.period,
      i.kwh ? Number(i.kwh) : null,
      i.rate ? Number(i.rate) : null,
      i.amount ? Number(i.amount) : null,
      i.issuedOn,
      i.dueOn,
      i.paidOn,
      i.paidAmount ? Number(i.paidAmount) : null,
      i.paidRef ?? null,
    ]);
    try {
      await download("/export/table.xlsx", "Invoices.xlsx", {
        what: "invoices",
        title: "Invoices",
        head: ["Invoice", "Kind", "Status", "Bill to", "Month", "kWh", "Rate (per kWh)", "Amount (S$)", "Issued", "Due", "Paid on", "Paid (S$)", "Reference"],
        rows,
      });
      toast(T("Downloaded. Open it in Excel."));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."), "bad");
    }
  };
  return (
    <>
      <TopBar title={T("Payments")} tabs={<SegTabs label={T("Payments")} value={shownTab} onChange={setTab} options={tabs.map((v) => ({ value: v, label: labels[v] }))} />} />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {board && (
            <Stack sx={{ gap: 2.5, mt: 2 }}>
              {!admin && (
                <Alert severity="info" data-testid="finance-pm-note">
                  {T("Whether each project's admin fee and each month has been invoiced and paid. Admin issues the invoices and confirms payments.")}
                </Alert>
              )}
              <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <IconButton aria-label={T("Previous year")} onClick={() => setYear((y) => y - 1)}>
                  <ChevronLeftRoundedIcon />
                </IconButton>
                <Typography sx={{ fontWeight: 700, fontSize: 18 }} data-testid="finance-year">
                  {year}
                </Typography>
                <IconButton aria-label={T("Next year")} onClick={() => setYear((y) => y + 1)}>
                  <ChevronRightRoundedIcon />
                </IconButton>
              </Stack>
              {data?.totals && (
                <Box sx={{ ...GRID, gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" } }} data-testid="finance-totals">
                  <Tile label={T("Invoiced")} value={money(data.totals.issued)} />
                  <Tile label={T("Received")} value={money(data.totals.paid)} tone="success.main" />
                  <Tile label={T("Outstanding")} value={money(data.totals.outstanding)} tone="warning.main" />
                  <Tile label={T("Overdue / proof sent")} value={`${data.totals.overdue} / ${data.totals.proofs}`} tone={data.totals.overdue ? "error.main" : undefined} />
                </Box>
              )}
              {!data && !error && <Skeleton variant="rounded" height={260} />}
              {admin && board === "fees" && data?.projects.some((p) => p.fee.state === "to_issue" && p.status !== "maintenance") && (
                <Button variant="contained" startIcon={<ReceiptLongRoundedIcon />} onClick={() => setFeeCheck({ only: null })} sx={{ alignSelf: "flex-start" }} data-testid="issue-fees">
                  {T("Issue admin fees")}
                </Button>
              )}
              {data && <StatusBoard data={data} show={board} onOpen={admin ? setOpen : undefined} onIssueFee={admin ? (id) => setFeeCheck({ only: id }) : undefined} />}
            </Stack>
          )}
          {shownTab === "invoices" && (
            <Stack sx={{ gap: 2, mt: 2 }}>
              <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
                <TextField label={T("Search")} placeholder={T("Invoice number, name or address")} value={q} onChange={(e) => setQ(e.target.value)} size="small" sx={{ flex: 1 }} />
                <Button variant="outlined" startIcon={<FileDownloadRoundedIcon />} disabled={!list.data?.invoices.length} onClick={() => void invoicesToExcel()} data-testid="invoices-excel">
                  {T("Download (Excel)")}
                </Button>
              </Stack>
              <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
                {FILTERS.map((f) => (
                  <Box key={f} component="button" type="button" onClick={() => setFilter(f)} sx={{ all: "unset" }}>
                    <Typography component="span" sx={{ px: 1.5, py: 0.5, borderRadius: 4, border: 1, borderColor: f === filter ? "primary.main" : "divider", bgcolor: f === filter ? "primary.main" : "transparent", color: f === filter ? "primary.contrastText" : "text.primary", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-block" }}>
                      {T(filterLabels[f])}
                    </Typography>
                  </Box>
                ))}
              </Stack>
              {list.error && <Alert severity="error">{list.error.message}</Alert>}
              {!list.data && !list.error && <Skeleton variant="rounded" height={200} />}
              {list.data?.invoices.length === 0 && (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {T("No invoices here.")}
                </Typography>
              )}
              <Stack sx={{ gap: 1 }}>
                {list.data?.invoices.map((inv) => (
                  <InvoiceRow key={inv.id} inv={inv} onOpen={() => setOpen(inv.id)} />
                ))}
              </Stack>
            </Stack>
          )}
          {shownTab === "issue" && (
            <Box sx={{ mt: 2 }}>
              <IssuePanel onIssued={again} />
            </Box>
          )}
          {shownTab === "statement" && (
            <Box sx={{ mt: 2 }}>
              <StatementPanel onConfirmed={again} />
            </Box>
          )}
          {shownTab === "design" && (
            <Box sx={{ mt: 2 }}>
              <DesignPanel />
            </Box>
          )}
        </Page>
      </Box>
      {open !== null && admin && <InvoiceDialog id={open} admin onClose={() => setOpen(null)} onChanged={again} />}
      {feeCheck && <FeeIssueDialog only={feeCheck.only} onClose={() => setFeeCheck(null)} onIssued={again} />}
    </>
  );
}

export default function FinancePage() {
  return (
    <Suspense>
      <FinanceScreen />
    </Suspense>
  );
}
