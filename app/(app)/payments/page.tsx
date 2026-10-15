"use client";

import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { InvoiceDialog, InvoiceRow } from "@/components/finance";
import { Page } from "@/components/shell";
import { TopBar } from "@/components/topbar";
import { useApi } from "@/lib/client/api";
import { useMe } from "@/lib/client/app-state";
import { money, type MyPayments } from "@/lib/client/finance";
import { T } from "@/lib/client/i18n";

/**
 * A homeowner's payments: what they owe now with the company's QR to pay
 * it (the invoice number as the reference), every invoice with its PDF, and
 * a receipt once Admin confirms each payment.
 */
function PaymentsScreen() {
  const me = useMe();
  const { data, error, reload } = useApi<MyPayments>(me?.role === "homeowner" ? "/payments" : null);
  // Opened from an alert: /payments?invoice=12.
  const params = useSearchParams();
  const [open, setOpen] = useState<number | null>(() => Number(params.get("invoice")) || null);
  if (!me) return null;
  if (me.role !== "homeowner") {
    return (
      <>
        <TopBar title={T("Payments")} />
        <Page>
          <Alert severity="info" sx={{ mt: 2 }}>
            {T("Payments are for homeowners.")}
          </Alert>
        </Page>
      </>
    );
  }
  const unpaid = data?.invoices.filter((i) => i.status === "issued") ?? [];
  const next = unpaid[unpaid.length - 1];

  return (
    <>
      <TopBar title={T("Payments")} />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {!data && !error && <Skeleton variant="rounded" height={220} sx={{ mt: 2 }} />}
          {data && (
            <Stack sx={{ gap: 2.5, mt: 2 }}>
              <Card sx={{ p: 2.5 }} data-testid="payments-owing">
                {unpaid.length === 0 ? (
                  <Stack sx={{ alignItems: "center", gap: 1, textAlign: "center" }}>
                    <CheckCircleRoundedIcon sx={{ fontSize: 44, color: "success.main" }} />
                    <Typography sx={{ fontWeight: 700, fontSize: 18 }}>{T("You're all paid up")}</Typography>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      {T("Each month's invoice appears here, with the QR to pay it.")}
                    </Typography>
                  </Stack>
                ) : (
                  <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) auto" }, alignItems: "center" }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {T("To pay")}
                      </Typography>
                      <Typography sx={{ fontWeight: 800, fontSize: 30, color: data.overdue ? "error.main" : "primary.main" }} data-fit>
                        {money(data.owing)}
                      </Typography>
                      {data.overdue > 0 && (
                        <Typography variant="body2" sx={{ color: "error.main", fontWeight: 600 }}>
                          {T("{n} overdue", { n: String(data.overdue) })}
                        </Typography>
                      )}
                      <Typography variant="body2" sx={{ mt: 1 }}>
                        {data.payNote}
                      </Typography>
                      {next && (
                        <Button variant="contained" size="large" startIcon={<ReceiptLongRoundedIcon />} sx={{ mt: 2 }} onClick={() => setOpen(next.id)} data-testid="pay-next">
                          {T("Pay {number}", { number: next.number })}
                        </Button>
                      )}
                    </Box>
                    {data.qr ? (
                      <Box component="img" src={data.qr} alt={T("Payment QR code")} sx={{ width: { xs: "100%", sm: 200 }, maxWidth: 240, aspectRatio: "1", objectFit: "contain", bgcolor: "#fff", borderRadius: 2, p: 1, mx: "auto" }} data-testid="payments-qr" />
                    ) : (
                      <Stack sx={{ alignItems: "center", color: "text.secondary" }}>
                        <QrCode2RoundedIcon sx={{ fontSize: 64 }} />
                        <Typography variant="caption">{T("The payment QR isn't set up yet. Contact 9 Solar Home to pay.")}</Typography>
                      </Stack>
                    )}
                  </Box>
                )}
              </Card>
              <Box>
                <Typography sx={{ fontWeight: 700, mb: 1 }}>{T("Invoices")}</Typography>
                {data.invoices.length === 0 ? (
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    {T("No invoices yet.")}
                  </Typography>
                ) : (
                  <Stack sx={{ gap: 1 }}>
                    {data.invoices.map((inv) => (
                      <InvoiceRow key={inv.id} inv={inv} onOpen={() => setOpen(inv.id)} />
                    ))}
                  </Stack>
                )}
              </Box>
            </Stack>
          )}
        </Page>
      </Box>
      {open !== null && data && <InvoiceDialog id={open} admin={false} qr={data.qr} payNote={data.payNote} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense>
      <PaymentsScreen />
    </Suspense>
  );
}
