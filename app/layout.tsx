import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "GetHomeApps — Deployment health",
  description: "GitHub → Vercel → Neon connectivity check for 9 Solar Home.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
