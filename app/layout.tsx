import type { Metadata, Viewport } from "next";

import { ClerkProvider } from "@clerk/nextjs";

import "./globals.css";

export const metadata: Metadata = {
  title: "GetHomeApps — Deployment health",
  description: "GitHub → Vercel → Neon → Clerk connectivity check for 9 Solar Home.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout paint behind the notch and home indicator, which is what
  // makes the env(safe-area-inset-*) padding meaningful. Without it those
  // values are always 0 and an installed app gets letterboxed.
  viewportFit: "cover",
  // Pinch-zoom stays available deliberately: this app is used outdoors on a
  // roof, and disabling zoom fails accessibility for anyone who needs it.
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#08090a" },
    { media: "(prefers-color-scheme: light)", color: "#08090a" },
  ],
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
