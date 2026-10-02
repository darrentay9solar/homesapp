import type { Metadata } from "next";

import { ClerkProvider } from "@clerk/nextjs";

import "./globals.css";

export const metadata: Metadata = {
  title: "GetHomeApps — Deployment health",
  description: "GitHub → Vercel → Neon → Clerk connectivity check for 9 Solar Home.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Clerk's own UI follows the app's dark palette rather than its defaults,
    // so a sign-in page does not look like a different product.
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#16c47f",
          colorBackground: "#0e1011",
          colorForeground: "#f4f6f5",
          borderRadius: "11px",
        },
      }}
    >
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
