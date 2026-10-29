"use client";

import type { ReactNode } from "react";

import { EditionGate } from "@/components/edition-gate";
import { EDITION } from "@/lib/client/edition";

/** GetApps only (lib/client/edition.ts): 9 Solar Home's app has no groups of projects. */
export default function Layout({ children }: { children: ReactNode }) {
  return <EditionGate on={EDITION === "fintech"}>{children}</EditionGate>;
}
