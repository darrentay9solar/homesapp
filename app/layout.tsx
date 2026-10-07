import type { Metadata, Viewport } from "next";

import { ClerkProvider } from "@clerk/nextjs";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { Fraunces, Poppins } from "next/font/google";
import { cookies } from "next/headers";

import { Providers } from "@/components/providers";

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

// The welcome headline only: a soft, curved display face to sit against
// Poppins' geometric UI type.
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["SOFT", "opsz"],
  display: "swap",
  variable: "--font-display",
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // English or Chinese, from the cookie the language setting writes, so the
  // first paint is already in the right language.
  const lang = (await cookies()).get("gha-lang")?.value === "zh" ? "zh" : "en";
  return (
    // Clerk's own screens use the app's tokens, so sign-in follows the
    // Black/Light choice instead of looking like a different product.
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "var(--mui-palette-primary-main)",
          colorBackground: "var(--mui-palette-background-paper)",
          colorForeground: "var(--mui-palette-text-primary)",
          colorMutedForeground: "var(--mui-palette-text-secondary)",
          colorInput: "var(--mui-palette-background-default)",
          colorInputForeground: "var(--mui-palette-text-primary)",
          colorNeutral: "var(--mui-palette-text-primary)",
          colorPrimaryForeground: "var(--mui-palette-primary-contrastText)",
          borderRadius: "11px",
          fontFamily: "var(--font-poppins), sans-serif",
        },
        elements: {
          cardBox: { boxShadow: "none", border: "1px solid var(--mui-palette-divider)", width: "100%" },
          rootBox: { width: "100%" },
        },
      }}
    >
      {/* suppressHydrationWarning: data-theme is set by the boot script
          before React hydrates, so it legitimately differs from the server. */}
      <html lang={lang === "zh" ? "zh-Hans-SG" : "en-SG"} className={`${poppins.variable} ${fraunces.variable}`} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        </head>
        <body>
          {/* Collects Material UI's styles during server rendering so pages
              arrive styled, with no flash of unstyled components. */}
          <AppRouterCacheProvider>
            <Providers lang={lang}>{children}</Providers>
          </AppRouterCacheProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
