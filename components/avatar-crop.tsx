"use client";

import Rotate90DegreesCwRoundedIcon from "@mui/icons-material/Rotate90DegreesCwRounded";
import ZoomInRoundedIcon from "@mui/icons-material/ZoomInRounded";
import ZoomOutRoundedIcon from "@mui/icons-material/ZoomOutRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type PointerEvent, useEffect, useRef, useState } from "react";

import { MDialog } from "@/components/m";
import { T } from "@/lib/client/i18n";

/** The saved picture's side, in pixels. */
export const SIDE = 512;
/** The frame on screen, in CSS pixels. */
const FRAME = 260;
const MAX_ZOOM = 4;

type View = { zoom: number; dx: number; dy: number; turn: 0 | 1 | 2 | 3 };

/** The picture's size once turned, and the scale at which it just fills the frame. */
function fit(img: HTMLImageElement, turn: number) {
  const sideways = turn % 2 === 1;
  const w = sideways ? img.naturalHeight : img.naturalWidth;
  const h = sideways ? img.naturalWidth : img.naturalHeight;
  return { w, h, cover: FRAME / Math.min(w, h) };
}

/** Keeps the picture covering the whole frame: no empty corners. */
export function clampView(img: HTMLImageElement, v: View): View {
  const { w, h, cover } = fit(img, v.turn);
  const s = cover * v.zoom;
  const maxX = Math.max(0, (w * s - FRAME) / 2);
  const maxY = Math.max(0, (h * s - FRAME) / 2);
  return { ...v, dx: Math.min(maxX, Math.max(-maxX, v.dx)), dy: Math.min(maxY, Math.max(-maxY, v.dy)) };
}

/** Draws exactly what's in the frame as a SIDE × SIDE JPEG. */
export function renderSquare(img: HTMLImageElement, v: View): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("This browser can't prepare the picture."));
  const k = SIDE / FRAME;
  const { cover } = fit(img, v.turn);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SIDE, SIDE);
  ctx.translate(SIDE / 2 + v.dx * k, SIDE / 2 + v.dy * k);
  ctx.rotate((v.turn * Math.PI) / 2);
  ctx.scale(cover * v.zoom * k, cover * v.zoom * k);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the picture."))), "image/jpeg", 0.88));
}

/**
 * Before a picture is saved: drag it to position the face in the circle, zoom,
 * and turn it if the phone saved it sideways. What's in the circle is what's
 * saved (a 512 px square, shown round everywhere in the app).
 */
export function CropDialog({ file, busy, onCancel, onUse }: { file: File; busy: boolean; onCancel: () => void; onUse: (blob: Blob) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, dx: 0, dy: 0, turn: 0 });
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);

  useEffect(() => {
    let live = true;
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => live && setImg(i);
    i.onerror = () => live && setProblem(T("That file isn't a picture this browser can open."));
    i.src = url;
    return () => {
      live = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const set = (next: Partial<View>) => setView((v) => (img ? clampView(img, { ...v, ...next }) : { ...v, ...next }));
  const scale = img ? fit(img, view.turn).cover * view.zoom : 1;

  return (
    <MDialog title={T("Position Picture")} heading={T("Drag to position, then zoom")} subtitle={T("What's inside the circle is your picture.")} onClose={onCancel} maxWidth="xs">
      <Box
        data-testid="crop-frame"
        onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, dx: view.dx, dy: view.dy };
        }}
        onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
          const d = drag.current;
          if (d) set({ dx: d.dx + e.clientX - d.x, dy: d.dy + e.clientY - d.y });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => set({ zoom: Math.min(MAX_ZOOM, Math.max(1, view.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))) })}
        sx={{
          position: "relative",
          width: FRAME,
          height: FRAME,
          mx: "auto",
          mt: 1,
          overflow: "hidden",
          borderRadius: 3,
          bgcolor: "grey.900",
          touchAction: "none",
          cursor: "grab",
          "&:active": { cursor: "grabbing" },
          userSelect: "none",
        }}
      >
        {img && (
          <Box
            component="img"
            src={img.src}
            alt=""
            draggable={false}
            sx={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: img.naturalWidth,
              height: img.naturalHeight,
              maxWidth: "none",
              transform: `translate(-50%, -50%) translate(${view.dx}px, ${view.dy}px) rotate(${view.turn * 90}deg) scale(${scale})`,
              transformOrigin: "center",
              pointerEvents: "none",
            }}
          />
        )}
        {/* Everything outside the circle is dimmed: that part isn't kept. */}
        <Box sx={{ position: "absolute", inset: 0, borderRadius: "50%", boxShadow: "0 0 0 999px rgba(0,0,0,0.55)", border: "2px solid rgba(255,255,255,0.9)", pointerEvents: "none" }} />
      </Box>
      {problem && (
        <Typography color="error" sx={{ textAlign: "center", mt: 2, fontWeight: 600 }}>
          {problem}
        </Typography>
      )}
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, mt: 2.5 }}>
        <IconButton aria-label={T("Zoom out")} onClick={() => set({ zoom: Math.max(1, view.zoom / 1.25) })}>
          <ZoomOutRoundedIcon />
        </IconButton>
        <Slider aria-label={T("Zoom")} min={1} max={MAX_ZOOM} step={0.01} value={view.zoom} onChange={(_, z) => set({ zoom: z as number })} data-testid="crop-zoom" />
        <IconButton aria-label={T("Zoom in")} onClick={() => set({ zoom: Math.min(MAX_ZOOM, view.zoom * 1.25) })}>
          <ZoomInRoundedIcon />
        </IconButton>
        <IconButton aria-label={T("Turn the picture")} onClick={() => set({ turn: ((view.turn + 1) % 4) as View["turn"], dx: 0, dy: 0 })} data-testid="crop-turn">
          <Rotate90DegreesCwRoundedIcon />
        </IconButton>
      </Stack>
      <Stack sx={{ gap: 1, mt: 2.5 }}>
        <Button size="large" variant="contained" disabled={!img || busy} data-testid="crop-use" onClick={() => img && void renderSquare(img, view).then(onUse, (e: Error) => setProblem(e.message))}>
          {busy ? T("Saving…") : T("Use picture")}
        </Button>
        <Button size="large" onClick={onCancel}>
          {T("Cancel")}
        </Button>
      </Stack>
    </MDialog>
  );
}
