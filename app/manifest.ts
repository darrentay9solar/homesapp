import type { MetadataRoute } from "next";

/**
 * Served at /manifest.webmanifest. This is what turns "a bookmark" into "an
 * app": without it, Add to Home Screen still works but launches inside the
 * browser, address bar and all.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable id means an install survives a change of name or start_url
    // instead of appearing as a second, separate app.
    id: "/",
    name: "GetHomeApps — 9 Solar Home",
    // Home screens truncate at roughly 12 characters.
    short_name: "GetHomeApps",
    description:
      "Track rooftop solar installations: milestones, site visits, documents and handover.",
    start_url: "/",
    scope: "/",
    // The whole point: no address bar, no browser toolbars.
    display: "standalone",
    background_color: "#08090A",
    theme_color: "#08090A",
    // Not locked. Crews use this one-handed in portrait; a PM reviewing on a
    // tablet will want landscape.
    orientation: "any",
    categories: ["business", "productivity", "utilities"],
    lang: "en-SG",
    dir: "ltr",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops icons to its own shape; the maskable variant keeps the
      // mark inside the safe zone so the roof line is not clipped off.
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
