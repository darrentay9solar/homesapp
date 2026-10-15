"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { DesignPanel, InvoiceDialog, InvoiceRow, IssuePanel, StatementPanel, StatusBoard } from "@/components/finance";
import { Page } from "@/components/shell";
import { GRID, SegTabs, TopBar } from "@/components/topbar";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { handlesPayments, useApp, useMe } from "@/lib/client/app-state";
import { type Invoice, money, type Overview } from "@/lib/client/finance";
import { T } from "@/lib/client/i18n";
import { useTab } from "@/lib/client/tabs";

type Tab = "overview" | "invoices" | "issue" | "statement" | "design";
const ADMIN_TABS: Tab[] = ["overview", "invoices", "issue", "statement", "design"];
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
  const fetcher = useFetcher();
  const { toast } = useApp();
  const admin = handlesPayments(me?.role);
  const [tab, setTab] = useTab<Tab>(ADMIN_TABS, "overview");
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, error, reload } = useApi<Overview>(me ? `/finance/overview?year=${year}` : null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const list = useApi<{ invoices: Invoice[] }>(admin && tab === "invoices" ? `/finance/invoices?status=${filter === "all" ? "" : filter}&q=${encodeURIComponent(q)}` : null);
  // Opened from an alert: /finance?invoice=12.
  const params = useSearchParams();
  const [open, setOpen] = useState<number | null>(() => Number(params.get("invoice")) || null);
  const [busyFee, setBusyFee] = useState<number | null>(null);


  if (!me) return null;
  const shownTab: Tab = admin ? tab : "overview";
  const labels: Record<Tab, string> = { overview: "Overview", invoices: "Invoices", issue: "Issue a month", statement: "Bank statement", design: "Invoice design" };
  const filterLabels: Record<Filter, string> = { all: "All", issued: "Unpaid", overdue: "Overdue", proof: "Proof sent", paid: "Paid", void: "Void" };
  const again = async () => {
    await reload();
    await list.reload();
  };
  const issueFee = async (projectId: number) => {
    setBusyFee(projectId);
    try {
      const r = await fetcher<{ message: string }>("/finance/admin-fee", { method: "POST", json: { projectId } });
      toast(r.message);
      await reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."), "bad");
    } finally {
      setBusyFee(null);
    }
  };

  return (
    <>
      <TopBar title={T("Payments")} tabs={admin ? <SegTabs label={T("Payments")} value={tab} onChange={setTab} options={ADMIN_TABS.map((v) => ({ value: v, label: labels[v] }))} /> : undefined} />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {shownTab === "overview" && (
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
              {data && <StatusBoard data={data} onOpen={admin ? setOpen : undefined} onIssueFee={admin ? (id) => void issueFee(id) : undefined} busyFee={busyFee} />}
            </Stack>
          )}
          {shownTab === "invoices" && (
            <Stack sx={{ gap: 2, mt: 2 }}>
              <TextField label={T("Search")} placeholder={T("Invoice number, name or address")} value={q} onChange={(e) => setQ(e.target.value)} size="small" />
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
