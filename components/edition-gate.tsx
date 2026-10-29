"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import { Page } from "@/components/shell";
import { T } from "@/lib/client/i18n";

/** A section this edition doesn't have (lib/client/edition.ts), reached by its address. */
export function EditionGate({ on, children }: { on: boolean; children: ReactNode }) {
  if (on) return <>{children}</>;
  return (
    <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
      <Page>
        <Alert severity="info" sx={{ mt: 2 }}>
          {T("This part of the app isn't used here.")}
        </Alert>
      </Page>
    </Box>
  );
}
