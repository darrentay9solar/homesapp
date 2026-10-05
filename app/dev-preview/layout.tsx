import { notFound } from "next/navigation";

import { MockApi } from "@/components/dev/mock-api";

/**
 * DEVELOPMENT ONLY: real screens with sample data and no sign-in, for
 * checking layouts. Never served in production.
 */
export default function DevPreviewLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== "development") notFound();
  return <MockApi>{children}</MockApi>;
}
