"use client";

import { PlantScreen } from "@/components/solar";

/** A homeowner's own system, as its monitoring shows it: what it makes today, this month, and since it was turned on. */
export default function MySolarPage() {
  return <PlantScreen base="/me/solar" staff={false} />;
}
