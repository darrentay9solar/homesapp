"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { Page } from "@/components/shell";
import { Conversation, useSupportHref } from "@/components/support";
import { TopBar } from "@/components/topbar";
import { useApi } from "@/lib/client/api";
import { isAdmin, useMe } from "@/lib/client/app-state";
import { T, TR } from "@/lib/client/i18n";
import { statusText, type Thread } from "@/lib/client/support";

/** One support conversation, kept up to date while it's open. */
export default function SupportThreadPage() {
  const me = useMe();
  const router = useRouter();
  const href = useSupportHref();
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApi<Thread>(me ? `/support/${id}` : null);

  // Answers arrive while it's open: on an alert, and every few seconds while the page is in view.
  useEffect(() => {
    const again = () => void reload();
    window.addEventListener("gha-alert", again);
    const timer = setInterval(() => document.visibilityState === "visible" && again(), 6000);
    return () => {
      window.removeEventListener("gha-alert", again);
      clearInterval(timer);
    };
  }, [reload]);

  if (!me) return null;
  const staff = isAdmin(me.role);
  const sub = data ? [data.project?.name, TR(statusText(data.status, staff))].filter(Boolean).join(" · ") : undefined;
  return (
    <>
      <TopBar title={data?.subject ?? T("Support")} sub={sub} onBack={() => router.push(href())} />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page narrow>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {!data && !error && <Skeleton variant="rounded" height={320} sx={{ mt: 2 }} />}
          {data && <Conversation t={data} me={me.uid} staff={staff} reload={reload} />}
        </Page>
      </Box>
    </>
  );
}
