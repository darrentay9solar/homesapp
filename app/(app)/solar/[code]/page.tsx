"use client";

import { useParams, usePathname, useRouter } from "next/navigation";

import { PlantScreen } from "@/components/solar";

/** One FusionSolar plant, for staff: its figures, charts, inverters, alarms and report. */
export default function PlantPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const preview = usePathname().startsWith("/dev-preview");
  return <PlantScreen base={`/solar/plants/${encodeURIComponent(decodeURIComponent(code))}`} staff onBack={() => router.push(preview ? "/dev-preview/solar" : "/solar")} />;
}
