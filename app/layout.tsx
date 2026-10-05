import type { Metadata, Viewport } from "next";

import { ClerkProvider } from "@clerk/nextjs";
import { Poppins } from "next/font/google";

import { THEME_BOOT_SCRIPT } from "@/lib/client/theme";

import "./globals.css";

// Poppins everywhere — self-hosted by Next.js at build time, so no request
// to Google from the visitor's browser and no layout shift while it loads.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: "GetHomeApps — 9 Solar Home",
  description: "Rooftop solar, tracked to the day. Milestones, site visits, documents and handover.",
  manifest: "/manifest.webmanifest",
  applicationName: "GetHomeApps",
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }],
    // iOS reads this rather than the manifest's icon list.
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    // iOS only honours standalone display through these tags, not the manifest.
    capable: true,
    title: "GetHomeApps",
    // Paint under the status bar; the safe-area insets account for it.
    statusBarStyle: "black-translucent",
  },
  // A rooftop tool should never have a phone number turned into a call link
  // behind our back.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout paint behind the notch and home indicator, which is what
  // makes the env(safe-area-inset-*) padding meaningful.
  viewportFit: "cover",
  // Pinch-zoom stays available: this app is used outdoors on a roof.
  maximumScale: 5,
  userScalable: true,
  themeColor: "#08090a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Clerk's own screens use the app's tokens, so sign-in follows the
    // Black/Light choice instead of looking like a different product.
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "var(--brand)",
          colorBackground: "var(--card)",
          colorForeground: "var(--tx)",
          colorMutedForeground: "var(--tx-3)",
          colorInput: "var(--card-2)",
          colorInputForeground: "var(--tx)",
          colorNeutral: "var(--tx)",
          colorPrimaryForeground: "var(--on-brand)",
          borderRadius: "11px",
          fontFamily: "var(--ff)",
        },
        elements: {
          cardBox: { boxShadow: "none", border: "1px solid var(--line-soft)", width: "100%" },
          rootBox: { width: "100%" },
        },
      }}
    >
      {/* suppressHydrationWarning: data-theme is set by the boot script
          before React hydrates, so it legitimately differs from the server. */}
      <html lang="en-SG" className={poppins.variable} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        </head>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
