"use client";

import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Slide from "@mui/material/Slide";
import Stack from "@mui/material/Stack";
import { alpha, type SxProps, type Theme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import TextField, { type TextFieldProps } from "@mui/material/TextField";
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

/** A settings-style row with a tinted icon tile, as on the reference's Profile screen. */
export function SettingRow({
  icon,
  tint,
  label,
  sub,
  right,
  children,
}: {
  icon: ReactNode;
  tint: string;
  label: string;
  sub?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card sx={{ px: 2, py: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1.75 }}>
        <Box sx={{ width: 38, height: 38, borderRadius: "11px", display: "grid", placeItems: "center", flex: "0 0 auto", color: tint, bgcolor: alpha(tint, 0.14) }}>
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 500 }}>{label}</Typography>
          {sub && (
            <Typography variant="caption" component="div" sx={{ color: "text.secondary" }}>
              {sub}
            </Typography>
          )}
        </Box>
        {right}
      </Stack>
      {children && <Box sx={{ mt: 1.5 }}>{children}</Box>}
    </Card>
  );
}

const SlideUp = forwardRef(function SlideUp(props: TransitionProps & { children: ReactElement }, ref: Ref<unknown>) {
  return <Slide direction="up" ref={ref} {...props} />;
});

/**
 * Every dialog in the app, in the account screens' design: a green header
 * with a wavy bottom edge, back arrow and centred title; then an optional
 * centred heading and subtitle, the fields, and one green button. Full screen
 * and sliding up on phones, a centred card on larger screens — the same
 * design either way.
 */
export function MDialog({
  open = true,
  onClose,
  title,
  heading,
  subtitle,
  children,
  maxWidth = "sm",
}: {
  open?: boolean;
  onClose: () => void;
  /** Shown in the green header. */
  title: string;
  /** The big centred line under the header, as on the sign-up screens. */
  heading?: string;
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
      slotProps={{ paper: { sx: { overflowX: "hidden" } } }}
    >
      <WaveHeader title={title} onBack={onClose} />
      <DialogContent sx={{ px: { xs: 3, sm: 4 }, pt: 0.5, pb: { xs: "calc(28px + env(safe-area-inset-bottom))", sm: 4 } }}>
        {heading && (
          <Typography sx={{ textAlign: "center", color: "primary.main", fontWeight: 600, fontSize: { xs: 19, sm: 21 } }}>
            {heading}
          </Typography>
        )}
        {subtitle && (
          <Typography
            variant="body2"
            sx={{ textAlign: "center", color: "text.secondary", mt: heading ? 0.75 : 0, mb: 3, mx: "auto", maxWidth: "40ch" }}
          >
            {subtitle}
          </Typography>
        )}
        {!subtitle && heading && <Box sx={{ mb: 3 }} />}
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** The green band with a wavy bottom edge (lower left, rising right) from the account screens. */
export function WaveHeader({ title, onBack, height = 112 }: { title: string; onBack: () => void; height?: number }) {
  return (
    <Box
      sx={{
        position: "relative",
        flex: "0 0 auto",
        height: `calc(${height}px + env(safe-area-inset-top))`,
        color: "#fff",
        "@media (min-width: 600px)": { height },
      }}
    >
      <Box component="svg" viewBox="0 0 440 112" preserveAspectRatio="none" aria-hidden="true" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <linearGradient id="waveHeaderFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0E7F53" />
            <stop offset="1" stopColor="#0A5C3E" />
          </linearGradient>
        </defs>
        <path d="M0 0H440V62C380 88 320 78 244 80C156 83 76 92 0 110Z" fill="url(#waveHeaderFill)" />
      </Box>
      <Stack direction="row" sx={{ position: "relative", alignItems: "center", px: 1, pt: { xs: "calc(8px + env(safe-area-inset-top))", sm: 1 } }}>
        <IconButton onClick={onBack} aria-label="Back" sx={{ color: "#fff" }}>
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography noWrap sx={{ flex: 1, textAlign: "center", fontWeight: 600, fontSize: 17, mr: 5 }}>
          {title}
        </Typography>
      </Stack>
    </Box>
  );
}

/**
 * A text field in the sign-up style: an icon at the start and the label
 * always sitting on the border.
 */
export function Field({ icon, ...props }: TextFieldProps & { icon?: ReactNode }) {
  return (
    <TextField
      {...props}
      slotProps={{
        ...props.slotProps,
        inputLabel: { shrink: true, ...(props.slotProps?.inputLabel as object) },
        input: {
          ...(icon ? { startAdornment: <InputAdornment position="start" sx={{ color: "text.secondary", "& svg": { fontSize: 20 } }}>{icon}</InputAdornment> } : {}),
          ...(props.slotProps?.input as object),
        },
      }}
    />
  );
}

/**
 * Mobile number in the sign-up style: one field, the country code picker
 * inside it on the left ("SG +65 ▾ | 9123 4567"). Stored as "+65 9123 4567".
 */
export function PhoneField({
  value,
  onChange,
  label = "Mobile",
  helperText,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  helperText?: string;
  required?: boolean;
}) {
  const [dial, setDial] = useState(() => splitPhone(value).dial);
  const { local } = splitPhone(value);
  return (
    <TextField
      label={label}
      required={required}
      type="tel"
      value={local}
      placeholder={dial === "65" ? "9123 4567" : "Mobile number"}
      helperText={helperText}
      onChange={(e) => onChange(joinPhone(dial, e.target.value.replace(/^\+/, "")))}
      slotProps={{
        inputLabel: { shrink: true },
        htmlInput: { inputMode: "tel", autoComplete: "tel-national" },
        input: {
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 1.25, pr: 1.25, height: "auto", alignSelf: "stretch", maxHeight: "none", borderRight: 1, borderColor: "divider" }}>
              <Select
                variant="standard"
                disableUnderline
                value={dial}
                onChange={(e) => {
                  setDial(e.target.value);
                  onChange(joinPhone(e.target.value, local));
                }}
                renderValue={(v) => `${COUNTRIES.find((c) => c.dial === v)?.code ?? ""} +${v}`}
                inputProps={{ "aria-label": "Country code" }}
                sx={{ fontWeight: 500, fontSize: 15, "& .MuiSelect-select": { py: 0, pr: "22px !important" } }}
              >
                {COUNTRIES.map((c) => (
                  <MenuItem key={c.code} value={c.dial}>
                    {c.name} (+{c.dial})
                  </MenuItem>
                ))}
              </Select>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
