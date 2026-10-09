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

import { CropDialog } from "@/components/avatar-crop";
import { RoleAvatar } from "@/components/m";
import { ApiError, useFetcher } from "@/lib/client/api";
import { type Role, useApp } from "@/lib/client/app-state";
import { useT } from "@/lib/client/i18n";

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
  // A chosen photo waits here while it's positioned and zoomed (CropDialog).
  const [chosen, setChosen] = useState<File | null>(null);

  async function upload(blob: Blob) {
    setBusy(true);
    try {
      const link = await fetcher<{ key: string; uploadUrl: string; headers: Record<string, string> }>(`${base}/avatar/upload-link`, {
        method: "POST",
        json: { contentType: "image/jpeg", size: blob.size },
      });
      const put = await fetch(link.uploadUrl, { method: "PUT", body: blob, headers: link.headers });
      if (!put.ok) throw new Error(t("The upload didn't go through. Please try again."));
      const r = await fetcher<{ message: string }>(`${base}/avatar`, { method: "POST", json: { key: link.key } });
      toast(r.message);
      setChosen(null);
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
          if (f) setChosen(f);
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
      {chosen && <CropDialog file={chosen} busy={busy} onCancel={() => setChosen(null)} onUse={(blob) => void upload(blob)} />}
    </Box>
  );
}
