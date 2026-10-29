"use client";

import type { ReactNode } from "react";

import { EditionGate } from "@/components/edition-gate";
import { FEATURES } from "@/lib/client/edition";

/** Only where this edition has it (lib/client/edition.ts). */
export default function Layout({ children }: { children: ReactNode }) {
  return <EditionGate on={FEATURES.checkIn}>{children}</EditionGate>;
}
