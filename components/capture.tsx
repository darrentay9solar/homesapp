"use client";

import CameraAltRoundedIcon from "@mui/icons-material/CameraAltRounded";
import CameraswitchRoundedIcon from "@mui/icons-material/CameraswitchRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { MDialog } from "@/components/m";
import { DESIGN } from "@/lib/client/design";
import { T } from "@/lib/client/i18n";

/**
 * Adding a photo or a file: a choice between taking a photo now (the phone's
 * camera app, or the laptop's camera in a window here) and choosing a file
 * already on the device (photos, documents, a shared drive).
 *
 *   const pick = useCapture({ accept, multiple, onFiles });
 *   <Button onClick={(e) => pick.open(e.currentTarget)} />  {pick.element}
 */
export function useCapture({
  accept,
  multiple = false,
  facing = "environment",
  onFiles,
  extra,
}: {
  accept: string;
  multiple?: boolean;
  /** The camera to start with: the back one for site photos, the front one for a profile picture. */
  facing?: "environment" | "user";
  onFiles: (files: File[]) => void;
  /** More menu rows after the two choices (e.g. Remove picture). */
  extra?: (close: () => void) => ReactNode;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [webcam, setWebcam] = useState(false);
  const close = useCallback(() => setAnchor(null), []);

  const takePhoto = () => {
    close();
    // A phone or tablet opens its own camera app from the file input; a laptop gets a camera window here.
    const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    if (touch) cameraInput.current?.click();
    else setWebcam(true);
  };
  const chooseFile = () => {
    close();
    fileInput.current?.click();
  };
  const take = (list: FileList | null) => {
    if (list?.length) onFiles([...list]);
  };

  const element = (
    <>
      <input ref={fileInput} hidden type="file" accept={accept} multiple={multiple} data-testid="pick-file-input" onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      <input ref={cameraInput} hidden type="file" accept="image/*" capture={facing} data-testid="pick-camera-input" onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close} data-testid="capture-menu">
        <MenuItem onClick={takePhoto} data-testid="take-photo">
          <ListItemIcon>
            <CameraAltRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={T("Take a photo")} secondary={T("With this device's camera")} />
        </MenuItem>
        <MenuItem onClick={chooseFile} data-testid="choose-file">
          <ListItemIcon>
            <FolderOpenRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={T("Choose a file")} secondary={T("Photos and documents on this device")} />
        </MenuItem>
        {extra?.(close)}
      </Menu>
      {webcam && (
        <CameraDialog
          facing={facing}
          onClose={() => setWebcam(false)}
          onTaken={(f) => {
            setWebcam(false);
            onFiles([f]);
          }}
          onFallback={() => {
            setWebcam(false);
            fileInput.current?.click();
          }}
        />
      )}
    </>
  );
  return { open: (el: HTMLElement) => setAnchor(el), element };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** A laptop's camera, live: take a photo, look at it, use it or take another. */
function CameraDialog({ facing, onClose, onTaken, onFallback }: { facing: "environment" | "user"; onClose: () => void; onTaken: (f: File) => void; onFallback: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState(facing);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<{ url: string; blob: Blob } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stop = () => stream.current?.getTracks().forEach((t) => t.stop());
    if (!navigator.mediaDevices?.getUserMedia) {
      queueMicrotask(() => setError(T("This browser can't use the camera here. Choose a file instead.")));
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stop();
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().then(() => setReady(true), () => setReady(true));
        }
      })
      .catch((e: unknown) => {
        const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
        setError(denied ? T("The camera is blocked. Allow it in the browser's address bar, or choose a file instead.") : T("No camera was found. Choose a file instead."));
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [mode]);

  useEffect(() => () => (shot ? URL.revokeObjectURL(shot.url) : undefined), [shot]);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob((b) => b && setShot({ url: URL.createObjectURL(b), blob: b }), "image/jpeg", 0.9);
  };

  return (
    <MDialog title={T("Take a Photo")} onClose={onClose} maxWidth="sm">
      <Box data-testid="camera-dialog">
        {error ? (
          <Stack sx={{ gap: 2 }}>
            <Alert severity="warning">{error}</Alert>
            <Button size="large" variant="contained" startIcon={<FolderOpenRoundedIcon />} onClick={onFallback}>
              {T("Choose a file")}
            </Button>
          </Stack>
        ) : (
          <>
            <Box sx={{ position: "relative", borderRadius: `${DESIGN.radius.card}px`, overflow: "hidden", bgcolor: "#000", aspectRatio: "4 / 3", display: "grid", placeItems: "center" }}>
              <Box component="video" ref={video} playsInline muted sx={{ width: "100%", height: "100%", objectFit: "cover", display: shot ? "none" : "block", transform: mode === "user" ? "scaleX(-1)" : "none" }} />
              {shot && <Box component="img" src={shot.url} alt={T("The photo just taken")} sx={{ width: "100%", height: "100%", objectFit: "contain" }} />}
              {!ready && !shot && <CircularProgress sx={{ position: "absolute", color: "#fff" }} />}
              {!shot && (
                <IconButton
                  aria-label={T("Switch camera")}
                  data-allow-overlap
                  onClick={() => {
                    setReady(false);
                    setMode((m) => (m === "user" ? "environment" : "user"));
                  }}
                  sx={{ position: "absolute", top: 8, right: 8, color: "#fff", bgcolor: "rgba(0,0,0,0.45)", "&:hover": { bgcolor: "rgba(0,0,0,0.6)" } }}
                >
                  <CameraswitchRoundedIcon />
                </IconButton>
              )}
            </Box>
            <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 1, mt: 2 }}>
              {shot ? (
                <>
                  <Button size="large" variant="outlined" startIcon={<ReplayRoundedIcon />} onClick={() => setShot(null)} sx={{ flex: 1 }}>
                    {T("Take another")}
                  </Button>
                  <Button size="large" variant="contained" onClick={() => onTaken(new File([shot.blob], `photo-${stamp()}.jpg`, { type: "image/jpeg" }))} sx={{ flex: 1 }} data-testid="use-photo">
                    {T("Use this photo")}
                  </Button>
                </>
              ) : (
                <Button size="large" variant="contained" startIcon={<CameraAltRoundedIcon />} disabled={!ready} onClick={capture} sx={{ flex: 1 }} data-testid="capture-photo">
                  {T("Take the photo")}
                </Button>
              )}
            </Stack>
          </>
        )}
      </Box>
    </MDialog>
  );
}
