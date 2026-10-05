"use client";

import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Slide from "@mui/material/Slide";
import Stack from "@mui/material/Stack";
import { alpha, type SxProps, type Theme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import TextField from "@mui/material/TextField";
import type { TransitionProps } from "@mui/material/transitions";
import Typography from "@mui/material/Typography";
import { forwardRef, type ReactElement, type ReactNode, type Ref, useState } from "react";

import type { Role } from "@/lib/client/app-state";
import { ROLE_COLOR } from "@/lib/client/mui-theme";

import { COUNTRIES, joinPhone, splitPhone } from "./phone-input";
import { initials } from "./ui";

export const ROLE_NAME: Record<Role, string> = {
  homeowner: "Homeowner",
  contractor: "Contractor Admin",
  epc_team: "EPC Team",
  project_manager: "Project Manager",
};

/** Tonal colour for a role: a soft tint behind, the strong colour in front. */
export function roleTone(role: Role): SxProps<Theme> {
  const c = ROLE_COLOR[role];
  return (t: Theme) => ({
    bgcolor: alpha(c.light, 0.12),
    color: c.light,
    ...t.applyStyles("dark", { bgcolor: alpha(c.dark, 0.16), color: c.dark }),
  });
}

export function RoleAvatar({ name, role, size = 40 }: { name: string | null; role: Role; size?: number }) {
  return (
    <Avatar sx={[{ width: size, height: size, fontSize: size * 0.36 }, roleTone(role)] as SxProps<Theme>}>
      {initials(name)}
    </Avatar>
  );
}

export function RoleChip({ role, label }: { role: Role; label?: string }) {
  return <Chip size="small" label={label ?? ROLE_NAME[role]} sx={roleTone(role)} />;
}

export function SectionTitle({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1, mt: 4, mb: 1.5 }}>
      <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1 }}>
        {title}
      </Typography>
      {count !== undefined && <Chip size="small" label={count} sx={{ height: 20, fontSize: "0.68rem" }} />}
      <Box sx={{ flex: 1 }} />
      {action}
    </Stack>
  );
}

const SlideUp = forwardRef(function SlideUp(props: TransitionProps & { children: ReactElement }, ref: Ref<unknown>) {
  return <Slide direction="up" ref={ref} {...props} />;
});

/** A dialog: full screen and sliding up on phones, centred on larger screens. */
export function MDialog({
  open = true,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = "sm",
}: {
  open?: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  maxWidth?: "xs" | "sm" | "md";
}) {
  const phone = useMediaQuery((t: Theme) => t.breakpoints.down("sm"));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={phone}
      fullWidth
      maxWidth={maxWidth}
      slots={{ transition: phone ? SlideUp : undefined }}
    >
      <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1, px: 3, pt: 2.5, pb: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ lineHeight: 1.3 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} aria-label="Close" edge="end">
          <CloseRoundedIcon />
        </IconButton>
      </Stack>
      <DialogContent sx={{ pt: 1, pb: 3 }}>{children}</DialogContent>
    </Dialog>
  );
}

/** Mobile number with a country code picker, stored as "+65 9123 4567". */
export function PhoneField({
  value,
  onChange,
  label = "Mobile",
  helperText,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  helperText?: string;
}) {
  const [dial, setDial] = useState(() => splitPhone(value).dial);
  const { local } = splitPhone(value);
  return (
    <Stack direction="row" sx={{ gap: 1 }}>
      <TextField
        select
        label="Code"
        value={dial}
        onChange={(e) => {
          setDial(e.target.value);
          onChange(joinPhone(e.target.value, local));
        }}
        sx={{ width: 118, flex: "0 0 auto" }}
        slotProps={{ select: { renderValue: (v) => `${COUNTRIES.find((c) => c.dial === v)?.code ?? ""} +${v}` } }}
      >
        {COUNTRIES.map((c) => (
          <MenuItem key={c.code} value={c.dial}>
            {c.name} (+{c.dial})
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label={label}
        type="tel"
        value={local}
        placeholder={dial === "65" ? "9123 4567" : ""}
        helperText={helperText}
        onChange={(e) => onChange(joinPhone(dial, e.target.value.replace(/^\+/, "")))}
        slotProps={{ htmlInput: { inputMode: "tel", autoComplete: "tel-national" } }}
      />
    </Stack>
  );
}
