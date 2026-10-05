"use client";

import Card from "@mui/material/Card";

import { Header, Page } from "@/components/shell";

/** Placeholder until this function is built. */
export default function Placeholder() {
  return (
    <>
      <Header title="Alerts" sub="Push notifications" />
      <Page>
        <Card sx={{ p: 5, mt: 2, textAlign: "center", color: "text.secondary" }}>Coming in a later build step.</Card>
      </Page>
    </>
  );
}
