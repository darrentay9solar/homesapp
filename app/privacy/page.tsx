"use client";

import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/icons";
import { LangButton, ThemeButton } from "@/components/theme-button";
import { gradText } from "@/components/topbar";
import { locale, T } from "@/lib/client/i18n";
import { DPO_EMAIL, PRIVACY_VERSION } from "@/lib/client/privacy";

/**
 * The privacy notice (Singapore's PDPA). Public: people read it before they
 * have an account. Written from what the app actually does (docs/pdpa.md);
 * 9 Solar Home approves the wording. A change here is a new PRIVACY_VERSION,
 * and everyone is asked to agree again.
 */
export default function PrivacyPage() {
  const dated = new Date(`${PRIVACY_VERSION}T00:00:00+08:00`).toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" });
  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default", px: 2, pt: 2, pb: 6 }}>
      <Box sx={{ maxWidth: 760, mx: "auto" }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap", mb: 2 }}>
          <Button component={Link} href="/" startIcon={<ArrowBackRoundedIcon />} sx={{ mr: "auto" }}>
            {T("Back")}
          </Button>
          <LangButton />
          <ThemeButton />
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, mb: 1 }}>
          <Logo size={40} />
          <Typography component="h1" variant="h5" sx={[{ minWidth: 0, overflowWrap: "anywhere" }, gradText()]}>
            {T("Privacy notice")}
          </Typography>
        </Stack>
        <Typography sx={{ color: "text.secondary", mb: 3 }}>
          {T("How 9 Solar Home uses your personal data in GetHomeApps. This version is dated {date}.", { date: dated })}
        </Typography>

        <Part title={T("Who we are")}>
          <Typography>
            {T("9 Solar Home runs GetHomeApps to install, look after and bill its customers' solar systems. We follow Singapore's Personal Data Protection Act 2012 (PDPA).")}
          </Typography>
        </Part>

        <Part title={T("What we collect")}>
          <Points
            items={[
              T("Your name, email address, mobile number and the language you use."),
              T("Homeowners: your address and postal code, your solar contract and system, what it generates, your invoices and payments, and the last 3 digits and letter of your NRIC if you give them. We never ask for your full NRIC."),
              T("Crew at a site: where your phone is when you check in and out, and when."),
              T("When you sign: your signature and name, the time, and the internet address and browser you signed from."),
              T("Photos and files you upload, your messages to support, and your replies to meetings."),
              T("A record of each change you make, so mistakes can be traced and put right."),
            ]}
          />
        </Part>

        <Part title={T("Why we use it")}>
          <Points
            items={[
              T("To set up your account and let you sign in."),
              T("To plan, install, inspect and maintain your solar system, and to show you how it's going."),
              T("To issue invoices and confirm payments under your contract."),
              T("To tell you about your account, projects, meetings and payments, in the app and by email, WhatsApp or SMS as you choose. We don't send marketing."),
              T("To answer your questions, and to meet our legal and accounting duties."),
            ]}
          />
        </Part>

        <Part title={T("Who sees it")}>
          <Points
            items={[
              T("Your project manager, the crew on your project and our admin team, only as far as their work needs."),
              T("Services that run the app for us: Neon (database, Singapore), Vercel (hosting, Singapore), Cloudflare (files), Clerk (sign-in), Resend (email), Meta (WhatsApp), Twilio (SMS), Anthropic (the support assistant) and OneMap (addresses). Some are outside Singapore; each is bound to protect your data to a standard comparable to the PDPA."),
              T("We never sell your personal data."),
            ]}
          />
        </Part>

        <Part title={T("How long we keep it")}>
          <Typography>
            {T("Only as long as your contract and the law need: for homeowners, the 8-year plan and 5 years after it. Requests that weren't approved are kept for 12 months. After that we delete it, or remove what identifies you.")}
          </Typography>
        </Part>

        <Part title={T("How we protect it")}>
          <Typography>
            {T("Sign-in is handled by Clerk, so your password never reaches us. Each person sees only what their role and projects allow, and the database itself enforces it. Files are private, and backups are encrypted.")}
          </Typography>
        </Part>

        <Part title={T("Your rights")}>
          <Points
            items={[
              T("See your data: Account → Profile → Download my data gives you a copy of what we hold about you."),
              T("Correct it: change your details in Account, or ask your project manager."),
              T("Turn off messages you don't want: Account → Settings → Notifications."),
              T("Withdraw your consent: tell us, and we'll stop using your data except what your contract or the law needs us to keep. We may then be unable to keep your account or service running."),
            ]}
          />
        </Part>

        <Part title={T("Contact us")}>
          <Typography sx={{ overflowWrap: "anywhere" }}>
            {DPO_EMAIL
              ? T("Our Data Protection Officer: {email}", { email: DPO_EMAIL })
              : T("Write to our Data Protection Officer through Help in the app, or ask your project manager.")}
          </Typography>
          <Typography sx={{ mt: 1 }}>
            {T("If your data is ever lost or exposed, we'll tell you and, where the law requires, the Personal Data Protection Commission.")}
          </Typography>
        </Part>
      </Box>
    </Box>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card component="section" sx={{ p: 2.25, mb: 1.5 }}>
      <Typography component="h2" sx={{ fontWeight: 600, fontSize: 16, mb: 1 }}>
        {title}
      </Typography>
      <Box sx={{ color: "text.primary", fontSize: 15, lineHeight: 1.6, overflowWrap: "anywhere", "& p": { lineHeight: 1.6 } }}>{children}</Box>
    </Card>
  );
}

function Points({ items }: { items: string[] }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 0.75 }}>
      {items.map((t) => (
        // Names in brackets ("Anthropic（客服助手）") don't break on their own; on a narrow phone they may.
        <Typography component="li" key={t} sx={{ overflowWrap: "anywhere" }}>
          {t}
        </Typography>
      ))}
    </Box>
  );
}
