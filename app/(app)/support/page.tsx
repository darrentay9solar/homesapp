"use client";

import AddCommentRoundedIcon from "@mui/icons-material/AddCommentRounded";
import SupportAgentRoundedIcon from "@mui/icons-material/SupportAgentRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Page } from "@/components/shell";
import { AnswersPanel, AskDialog, ChatStart, ThreadCard, useSupportHref } from "@/components/support";
import { GRID, SegTabs, TopBar } from "@/components/topbar";
import { ContactLinks, ContactNumbers } from "@/components/contact";
import { useApi } from "@/lib/client/api";
import { useMe } from "@/lib/client/app-state";
import { T } from "@/lib/client/i18n";
import { type Inbox, inTab, type SupportTab } from "@/lib/client/support";
import { useTab } from "@/lib/client/tabs";

type Tab = SupportTab | "answers";
const STAFF_TABS: Tab[] = ["waiting", "open", "assistant", "settled", "all", "answers"];

/**
 * Help (homeowners) and Support (everyone else). A homeowner asks a
 * question; the assistant answers what it can and their project manager the
 * rest. Managers see the conversations they handle, newest first, with the
 * people waiting for an answer on the first tab, and keep the assistant's
 * answers on the last.
 */
function SupportScreen() {
  const me = useMe();
  const router = useRouter();
  const href = useSupportHref();
  const { data, error, reload } = useApi<Inbox>(me ? "/support" : null);
  const staff = Boolean(data?.staff);
  const [tab, setTab] = useTab<Tab>(STAFF_TABS, "waiting");
  const [asking, setAsking] = useState(false);

  // New messages arrive while the list is open.
  useEffect(() => {
    const again = () => void reload();
    window.addEventListener("gha-alert", again);
    const timer = setInterval(() => document.visibilityState === "visible" && again(), 20000);
    return () => {
      window.removeEventListener("gha-alert", again);
      clearInterval(timer);
    };
  }, [reload]);

  if (!me) return null;
  const homeowner = me.role === "homeowner";
  const threads = data?.threads ?? [];
  const shown = staff ? (tab === "answers" ? [] : inTab(threads, tab)) : threads;
  const count = (t: SupportTab) => inTab(threads, t).length;
  const labels: Record<Tab, string> = { waiting: "Waiting", open: "In progress", assistant: "With the assistant", settled: "Settled", all: "All", answers: "Answers" };
  // A homeowner's Help opens on a chat with the assistant; their past conversations follow.
  const chat = Boolean(data && !staff && data.assistant && data.canAsk);

  return (
    <>
      <TopBar
        title={homeowner ? T("Help") : T("Support")}
        action={
          data?.canAsk ? (
            <Button onClick={() => setAsking(true)} startIcon={<AddCommentRoundedIcon />} sx={{ color: "#073f2b", bgcolor: "#fff", height: 36, "&:hover": { bgcolor: "#eafff4" } }} data-testid="support-ask">
              {T("Ask")}
            </Button>
          ) : undefined
        }
        tabs={
          staff ? (
            <SegTabs
              label={T("Support")}
              value={tab}
              onChange={setTab}
              options={STAFF_TABS.map((v) => ({ value: v, label: labels[v], count: v === "answers" ? undefined : count(v) }))}
            />
          ) : undefined
        }
      />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {!data && !error && (
            <Box sx={{ ...GRID, mt: 2 }}>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} variant="rounded" height={118} />
              ))}
            </Box>
          )}
          {data && staff && tab === "answers" && (
            <Box sx={{ mt: 2 }}>
              <AnswersPanel />
            </Box>
          )}
          {chat && data && <ChatStart name={me.fullName?.split(" ")[0] ?? null} projects={data.projects} ai={data.ai} onStarted={(id) => router.push(href(id))} />}
          {data && !staff && (
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 1.5 }} data-testid="support-contact-link">
              {T("Prefer to call, WhatsApp or email?")}{" "}
              <Box component="a" href="#contact" sx={{ color: "primary.main", fontWeight: 600, textDecoration: "none" }}>
                {T("Contact us")}
              </Box>
            </Typography>
          )}
          {chat && shown.length > 0 && (
            <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 3, mb: -1, fontWeight: 600 }}>
              {T("Your conversations")}
            </Typography>
          )}
          {data && !chat && !(staff && tab === "answers") && shown.length === 0 && (
            <Card sx={{ p: 4, mt: 2, textAlign: "center" }} data-testid="support-empty">
              <SupportAgentRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
              <Typography sx={{ fontWeight: 600, mt: 1 }}>
                {staff ? (tab === "waiting" ? T("No one is waiting for an answer") : T("Nothing here")) : T("Questions about your solar system?")}
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5, maxWidth: "52ch", mx: "auto" }}>
                {staff
                  ? T("When a homeowner asks for a person, it appears here and you get an alert. Their project's manager handles it; anyone can be brought in.")
                  : data.assistant
                    ? T("Ask anything. The assistant answers common questions straight away; for anything else, your project manager takes over here.")
                    : T("Ask anything, and your project manager answers here.")}
              </Typography>
              {data.canAsk && (
                <Button variant="contained" size="large" startIcon={<AddCommentRoundedIcon />} sx={{ mt: 2.5 }} onClick={() => setAsking(true)}>
                  {T("Ask a question")}
                </Button>
              )}
            </Card>
          )}
          {shown.length > 0 && (
            <Box sx={{ ...GRID, mt: 2 }}>
              {shown.map((t) => (
                <ThreadCard key={t.id} t={t} staff={staff} onOpen={() => router.push(href(t.id))} />
              ))}
            </Box>
          )}
          {/* Instead of Help, a homeowner can call, WhatsApp or write to 9 Solar Home (the same as the public Contact page). */}
          {data && !staff && (
            <Box component="section" id="contact" sx={{ mt: 4, scrollMarginTop: 16 }} data-testid="support-contact">
              <Typography component="h2" sx={{ fontWeight: 600, fontSize: 16 }}>
                {T("Prefer to reach us another way?")}
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5, mb: 1.5 }}>
                {T("You don't have to use Help: call, WhatsApp or email 9 Solar Home directly.")}
              </Typography>
              <Stack sx={{ gap: 1.5 }}>
                <ContactNumbers />
                <ContactLinks />
              </Stack>
            </Box>
          )}
        </Page>
      </Box>
      {asking && data && <AskDialog projects={data.projects} assistant={data.assistant} onClose={() => setAsking(false)} onAsked={(id) => router.push(href(id))} />}
    </>
  );
}

export default function SupportPage() {
  return (
    <Suspense>
      <SupportScreen />
    </Suspense>
  );
}
