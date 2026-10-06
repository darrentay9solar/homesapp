"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import { Page } from "./shell";
import { TopBar } from "./topbar";

/** A screen whose function isn't built yet, in the same design as the rest. */
export function ComingSoon({ title, sub, icon, heading, text }: { title: string; sub: string; icon: ReactNode; heading: string; text: string }) {
  return (
    <>
      <TopBar title={title} sub={sub} />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          <Card sx={{ p: 4, mt: 2, textAlign: "center" }}>
            <Box sx={{ color: "primary.main", "& svg": { fontSize: 42 } }}>{icon}</Box>
            <Typography sx={{ fontWeight: 600, mt: 1 }}>{heading}</Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5, maxWidth: "46ch", mx: "auto" }}>
              {text}
            </Typography>
          </Card>
        </Page>
      </Box>
    </>
  );
}
