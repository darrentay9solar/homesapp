"use client";

import CallRoundedIcon from "@mui/icons-material/CallRounded";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { T } from "@/lib/client/i18n";
import { CONTACT, telHref, whatsappHref } from "@/lib/client/contact";

/** A number to call or message on WhatsApp, and who it's for. */
function Line({ who, number, testId }: { who: string; number: string; testId: string }) {
  return (
    <Box data-testid={testId}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {who}
      </Typography>
      <Typography sx={{ fontWeight: 700, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{number}</Typography>
      <Stack direction="row" sx={{ gap: 1, mt: 0.75, flexWrap: "wrap" }}>
        <Button size="small" variant="outlined" startIcon={<CallRoundedIcon />} href={telHref(number)}>
          {T("Call")}
        </Button>
        <Button size="small" variant="outlined" startIcon={<WhatsAppIcon />} href={whatsappHref(number)} target="_blank" rel="noopener">
          {T("WhatsApp")}
        </Button>
      </Stack>
    </Box>
  );
}

/** Who to call or write to at 9 Solar Home. */
export function ContactNumbers() {
  return (
    <Card sx={{ p: 2.25 }} data-testid="contact-numbers">
      <Typography component="h2" sx={{ fontWeight: 600, fontSize: 16, mb: 1.5 }}>
        {T("Talk to us")}
      </Typography>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "1fr 1fr" } }}>
        <Line who={T("New clients")} number={CONTACT.newClients} testId="contact-new" />
        <Line who={T("Existing customers (after sales)")} number={CONTACT.postSales} testId="contact-post-sales" />
      </Box>
      <Button startIcon={<MailOutlineRoundedIcon />} href={`mailto:${CONTACT.email}`} sx={{ mt: 2, maxWidth: "100%", textTransform: "none" }}>
        <Box component="span" sx={{ overflowWrap: "anywhere" }}>
          {CONTACT.email}
        </Box>
      </Button>
    </Card>
  );
}

/** The company's plans, brochure, booking and common questions (pages of its own, outside the app). */
export function ContactLinks() {
  return (
    <Card sx={{ p: 2.25 }} data-testid="contact-links">
      <Typography component="h2" sx={{ fontWeight: 600, fontSize: 16, mb: 1 }}>
        {T("Install free solar, $0 capex")}
      </Typography>
      <Stack sx={{ gap: 0.5, alignItems: "flex-start" }}>
        {CONTACT.links.map((l) => (
          <Button key={l.href} href={l.href} target="_blank" rel="noopener" endIcon={<OpenInNewRoundedIcon fontSize="small" />} sx={{ textAlign: "left", maxWidth: "100%" }}>
            {T(l.label)}
          </Button>
        ))}
      </Stack>
    </Card>
  );
}
