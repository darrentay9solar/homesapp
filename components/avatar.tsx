"use client";

import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import PhotoCameraRoundedIcon from "@mui/icons-material/PhotoCameraRounded";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useRef, useState } from "react";

import { RoleAvatar } from "@/components/m";
import { ApiError, useFetcher } from "@/lib/client/api";
import { type Role, useApp } from "@/lib/client/app-state";
import { useT } from "@/lib/client/i18n";

const SIDE = 512;

/** A photo as a 512 px square JPEG (centre crop), so uploads are small and every picture looks alike. */
export async function squareJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't a picture this browser can open."));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(SIDE, side);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't prepare the picture.");
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the picture."))), "image/jpeg", 0.86));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A person's picture with a camera button: choose a new one, or remove it.
 * `base` is "/me" for your own, or "/people/<uid>" for a project manager
 * changing someone else's (the server allows only those two cases).
 */
export function AvatarEditor({
  name,
  role,
  src,
  base,
  size = 72,
  onChanged,
}: {
  name: string | null;
  role: Role;
  src: string | null | undefined;
  base: string;
  size?: number;
  onChanged: () => Promise<void> | void;
}) {
  const t = useT();
  const fetcher = useFetcher();
  const { toast } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const blob = await squareJpeg(file);
      const link = await fetcher<{ key: string; uploadUrl: string; headers: Record<string, string> }>(`${base}/avatar/upload-link`, {
        method: "POST",
        json: { contentType: "image/jpeg", size: blob.size },
      });
      const put = await fetch(link.uploadUrl, { method: "PUT", body: blob, headers: link.headers });
      if (!put.ok) throw new Error(t("The upload didn't go through. Please try again."));
      const r = await fetcher<{ message: string }>(`${base}/avatar`, { method: "POST", json: { key: link.key } });
      toast(r.message);
      await onChanged();
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : t("Couldn't change the picture."), "bad");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setMenu(null);
    setBusy(true);
    try {
      const r = await fetcher<{ message: string }>(`${base}/avatar`, { method: "DELETE" });
      toast(r.message);
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't remove the picture."), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ position: "relative", width: size, height: size, flex: "0 0 auto" }} data-testid="avatar-editor">
      <RoleAvatar name={name} role={role} size={size} src={src} />
      {busy && <CircularProgress size={size} sx={{ position: "absolute", inset: 0, color: "primary.main" }} />}
      <IconButton
        size="small"
        aria-label={t("Change picture")}
        disabled={busy}
        onClick={(e) => (src ? setMenu(e.currentTarget) : input.current?.click())}
        sx={{ position: "absolute", right: -4, bottom: -4, bgcolor: "primary.main", color: "primary.contrastText", border: 2, borderColor: "background.paper", "&:hover": { bgcolor: "primary.dark" }, width: 30, height: 30 }}
      >
        <PhotoCameraRoundedIcon sx={{ fontSize: 16 }} />
      </IconButton>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            setMenu(null);
            input.current?.click();
          }}
        >
          <ListItemIcon>
            <PhotoCameraRoundedIcon fontSize="small" />
          </ListItemIcon>
          {t("Choose a new picture")}
        </MenuItem>
        <MenuItem onClick={() => void remove()} sx={{ color: "error.main" }}>
          <ListItemIcon sx={{ color: "inherit" }}>
            <DeleteOutlineRoundedIcon fontSize="small" />
          </ListItemIcon>
          {t("Remove picture")}
        </MenuItem>
      </Menu>
    </Box>
  );
}
