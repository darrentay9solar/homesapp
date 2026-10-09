"use client";

import "leaflet/dist/leaflet.css";

import Box from "@mui/material/Box";
import type { Map as LeafletMap, LayerGroup, TileLayer } from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";

import { DESIGN } from "@/lib/client/design";
import { type LatLng, SINGAPORE } from "@/lib/client/location";
import { getFix } from "@/lib/client/sites";
import { useTheme } from "@/lib/client/theme";

/**
 * A map of Singapore (OneMap, the Singapore Land Authority's map), in the
 * app's theme: OneMap's Night style in Black, its Default style in Light.
 *
 *  - pins: sites (a green dot that glows when picked, as in the reference
 *    design) or people (their initials, or picture, in their role colour)
 *  - me: the phone's own position, a blue dot with its accuracy ring
 *
 * Tapping a pin calls onPick. The map fits everything on it whenever the set
 * of pins changes, and pans to the picked one.
 */

export type Pin = {
  id: string;
  lat: number;
  lng: number;
  kind: "site" | "person";
  label: string;
  /** Person pins: their initials and role colour, or a picture. */
  initials?: string;
  color?: string;
  avatar?: string | null;
  /** Faded: an old position, or a site you can't check in at. */
  dim?: boolean;
};

type Props = {
  pins: Pin[];
  picked?: string | null;
  onPick?: (id: string) => void;
  me?: (LatLng & { accuracy?: number | null }) | null;
  height?: number | string | Record<string, number | string>;
  testId?: string;
  /** Something laid over the map's bottom edge (the Sites cards): the credit and zoom buttons sit above it. */
  bottomInset?: number | Partial<Record<"xs" | "sm" | "md" | "lg" | "xl", number>>;
};

const TILES = {
  dark: "https://www.onemap.gov.sg/maps/tiles/Night/{z}/{x}/{y}.png",
  light: "https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png",
};
const ATTRIBUTION =
  '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" style="height:14px;width:14px;vertical-align:-2px" alt=""/> ' +
  '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a> &copy; contributors | ' +
  '<a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>';
// OneMap only draws Singapore.
const BOUNDS: [[number, number], [number, number]] = [
  [1.144, 103.535],
  [1.494, 104.131],
];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function pinHtml(p: Pin, picked: boolean, green: string): string {
  if (p.kind === "site") {
    const size = picked ? 46 : 26;
    return `<div class="gha-pin gha-site${picked ? " on" : ""}${p.dim ? " dim" : ""}" style="--g:${green};width:${size}px;height:${size}px"><span></span></div>`;
  }
  const face = p.avatar
    ? `<img src="${esc(p.avatar)}" alt="" />`
    : `<b>${esc(p.initials ?? "?")}</b>`;
  return `<div class="gha-pin gha-person${picked ? " on" : ""}${p.dim ? " dim" : ""}" style="--c:${p.color ?? green}">${face}</div>`;
}

export function MapView({ pins, picked = null, onPick, me = null, height = 360, testId = "map", bottomInset = 0 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const tiles = useRef<TileLayer | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const meLayer = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const fitted = useRef("");
  const pick = useRef(onPick);
  const [theme] = useTheme();
  const green = theme === "dark" ? DESIGN.green.dark : DESIGN.green.light;

  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  // Create the map once (Leaflet needs the browser, so it loads here).
  useEffect(() => {
    let gone = false;
    void import("leaflet").then((mod) => {
      if (gone || !box.current || map.current) return;
      L.current = mod;
      const m = mod.map(box.current, {
        center: [SINGAPORE.lat, SINGAPORE.lng],
        zoom: 12,
        minZoom: 11,
        maxZoom: 19,
        maxBounds: BOUNDS,
        maxBoundsViscosity: 0.8,
        zoomControl: false,
        attributionControl: true,
      });
      mod.control.zoom({ position: "topright" }).addTo(m);
      m.attributionControl.setPrefix(false);
      layer.current = mod.layerGroup().addTo(m);
      meLayer.current = mod.layerGroup().addTo(m);
      map.current = m;
      // Draw what's waiting.
      setTimeout(() => m.invalidateSize(), 0);
      box.current.dispatchEvent(new Event("gha-map-ready"));
    });
    return () => {
      gone = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Tiles follow the theme.
  useEffect(() => {
    const draw = () => {
      if (!map.current || !L.current) return;
      tiles.current?.remove();
      tiles.current = L.current.tileLayer(theme === "dark" ? TILES.dark : TILES.light, { attribution: ATTRIBUTION, detectRetina: true, maxNativeZoom: 19 }).addTo(map.current);
    };
    draw();
    const el = box.current;
    el?.addEventListener("gha-map-ready", draw);
    return () => el?.removeEventListener("gha-map-ready", draw);
  }, [theme]);

  // Pins, and the fit.
  useEffect(() => {
    const draw = () => {
      const mod = L.current;
      if (!map.current || !mod || !layer.current) return;
      layer.current.clearLayers();
      for (const p of pins) {
        const on = p.id === picked;
        const size = p.kind === "site" ? (on ? 46 : 26) : on ? 46 : 38;
        const marker = mod.marker([p.lat, p.lng], {
          icon: mod.divIcon({ html: pinHtml(p, on, green), className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
          title: p.label,
          keyboard: true,
          zIndexOffset: on ? 1000 : 0,
        });
        marker.on("click", () => pick.current?.(p.id));
        marker.addTo(layer.current);
      }
      const key = pins.map((p) => `${p.id}:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|");
      if (key !== fitted.current && pins.length) {
        fitted.current = key;
        const b = mod.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
        if (me) b.extend([me.lat, me.lng]);
        map.current.fitBounds(b.pad(0.25), { maxZoom: 16, animate: false });
      }
    };
    draw();
    const el = box.current;
    el?.addEventListener("gha-map-ready", draw);
    return () => el?.removeEventListener("gha-map-ready", draw);
  }, [pins, picked, green, me]);

  // Pan to the picked pin.
  useEffect(() => {
    const p = pins.find((x) => x.id === picked);
    if (p && map.current) map.current.panTo([p.lat, p.lng], { animate: true });
  }, [picked, pins]);

  // Where the phone is.
  useEffect(() => {
    const draw = () => {
      const mod = L.current;
      if (!map.current || !mod || !meLayer.current) return;
      meLayer.current.clearLayers();
      if (!me) return;
      if (me.accuracy) mod.circle([me.lat, me.lng], { radius: me.accuracy, color: "#3B82F6", weight: 1, fillOpacity: 0.12 }).addTo(meLayer.current);
      mod.marker([me.lat, me.lng], {
        icon: mod.divIcon({ html: '<div class="gha-me"></div>', className: "", iconSize: [18, 18], iconAnchor: [9, 9] }),
        interactive: false,
      }).addTo(meLayer.current);
    };
    draw();
    const el = box.current;
    el?.addEventListener("gha-map-ready", draw);
    return () => el?.removeEventListener("gha-map-ready", draw);
  }, [me]);

  return (
    <Box
      ref={box}
      data-testid={testId}
      role="region"
      aria-label="Map"
      sx={(t) => ({
        height,
        width: "100%",
        borderRadius: `${DESIGN.radius.card}px`,
        overflow: "hidden",
        border: 1,
        borderColor: "divider",
        bgcolor: t.palette.mode === "dark" ? "#1b1f24" : "#e8ecef",
        zIndex: 0,
        position: "relative",
        fontFamily: "inherit",
        "& .leaflet-container": { fontFamily: "inherit", background: "transparent" },
        "& .leaflet-container *, & .leaflet-bar a": { fontFamily: "inherit" },
        "& .leaflet-control-attribution": { fontSize: 9, bgcolor: t.palette.mode === "dark" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.75)", color: "text.secondary" },
        "& .leaflet-control-attribution a": { color: "inherit" },
        // The credit must stay readable (OneMap's terms), so it moves above anything covering the map's foot.
        "& .leaflet-bottom": { bottom: bottomInset },
        "& .leaflet-bar a": { bgcolor: "background.paper", color: "text.primary", borderColor: "divider" },
        // Pins
        "& .gha-pin": { borderRadius: "50%", display: "grid", placeItems: "center", cursor: "pointer", transition: "transform 150ms" },
        "& .gha-site": { bgcolor: "color-mix(in srgb, var(--g) 22%, transparent)", border: "1.5px solid color-mix(in srgb, var(--g) 70%, transparent)" },
        "& .gha-site span": { width: 10, height: 10, borderRadius: "50%", bgcolor: "#fff", boxShadow: "0 0 0 2px var(--g)" },
        "& .gha-site.on": { bgcolor: "color-mix(in srgb, var(--g) 28%, transparent)", border: "2px solid var(--g)", boxShadow: "0 0 0 6px color-mix(in srgb, var(--g) 18%, transparent)" },
        "& .gha-site.on span": { width: 16, height: 16, bgcolor: "var(--g)", boxShadow: "0 0 0 3px #fff" },
        "& .gha-person": { width: "100%", height: "100%", bgcolor: "var(--c)", color: "#fff", border: "2.5px solid #fff", boxShadow: "0 4px 12px rgba(0,0,0,0.35)", overflow: "hidden", fontSize: 12.5 },
        "& .gha-person b": { fontWeight: 700 },
        "& .gha-person img": { width: "100%", height: "100%", objectFit: "cover" },
        "& .gha-person.on": { boxShadow: "0 0 0 5px color-mix(in srgb, var(--c) 35%, transparent), 0 4px 12px rgba(0,0,0,0.35)" },
        "& .gha-pin.dim": { opacity: 0.55, filter: "grayscale(0.6)" },
        "& .gha-me": { width: 18, height: 18, borderRadius: "50%", bgcolor: "#3B82F6", border: "3px solid #fff", boxShadow: "0 0 0 6px rgba(59,130,246,0.25)" },
      })}
    />
  );
}

/**
 * The phone's position for the map. Asks only when `locate` is called, or
 * straight away when the person already allowed it, so opening a screen
 * never springs a permission prompt on anyone.
 */
export function useMyPosition() {
  const [pos, setPos] = useState<(LatLng & { accuracy: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const locate = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      setPos(await getFix(15_000));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    let gone = false;
    void navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((st) => {
        if (!gone && st.state === "granted") void locate();
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [locate]);
  return { pos, busy, problem, locate };
}
