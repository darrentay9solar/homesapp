"use client";

import { SignOutButton } from "@clerk/nextjs";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import PaymentsRoundedIcon from "@mui/icons-material/PaymentsRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

import { RoleAvatar, RoleChip, SettingRow } from "@/components/m";
import { Page } from "@/components/shell";
import { Heading, TopBar } from "@/components/topbar";
import { type Role, useMe } from "@/lib/client/app-state";
import { useTheme } from "@/lib/client/theme";

const ACCESS: Record<Role, string> = {
  homeowner: "View your own project only. Approve or decline the project and e-sign the handover certificate.",
  project_manager:
    "Full system administrator. Create projects, override any field, schedule EPC visits, manage accounts and close projects. Every action you take is written to the audit log.",
  contractor:
    "Fill and edit every milestone field for your contractor groups' projects, and schedule EPC site visits. No access to project creation or project details.",
  epc_team:
    "Everything the contractor admin can do — every milestone field and site scheduling — plus GPS check-in and check-out with crew counts.",
};

/** Your account, in the same design as a person's Profile in People. */
export default function AccountPage() {
  const me = useMe();
  const [theme, setTheme] = useTheme();
  if (!me) return null;
  return (
    <>
      <TopBar title="Account" sub={me.roleLabel} />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page narrow>
          <Card sx={{ p: 2.5, mt: 1, display: "flex", gap: 2, alignItems: "center" }}>
            <RoleAvatar name={me.fullName ?? me.email} role={me.role} size={64} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600, fontSize: 18, color: "primary.main", overflowWrap: "anywhere" }}>{me.fullName ?? "—"}</Typography>
              <Box sx={{ mt: 0.5 }}>
                <RoleChip role={me.role} />
              </Box>
            </Box>
          </Card>

          <Heading title="Contact" />
          <Stack sx={{ gap: 1.25 }}>
            <SettingRow icon={<MailOutlineRoundedIcon />} tint="#2563EB" label="Email" sub={<Box sx={{ overflowWrap: "anywhere" }}>{me.email}</Box>} />
            <SettingRow icon={<PhoneRoundedIcon />} tint="#0A9A63" label="Mobile" sub={me.contactNo ?? "Not on file. Ask a project manager to add it."} />
          </Stack>

          <Heading title="Appearance" />
          <SettingRow icon={theme === "dark" ? <DarkModeRoundedIcon /> : <LightModeRoundedIcon />} tint="#7C3AED" label="Theme" sub="Light is easier to read on a rooftop in daylight; Black saves battery indoors.">
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={theme}
              onChange={(_, v) => v && setTheme(v)}
              aria-label="Appearance"
              sx={{ "& .MuiToggleButton-root": { gap: 1, py: 1 } }}
            >
              <ToggleButton value="dark">
                <DarkModeRoundedIcon fontSize="small" /> Black
              </ToggleButton>
              <ToggleButton value="light">
                <LightModeRoundedIcon fontSize="small" /> Light
              </ToggleButton>
            </ToggleButtonGroup>
          </SettingRow>

          <Heading title="Your access" />
          <SettingRow icon={<ShieldOutlinedIcon />} tint="#B45309" label={me.roleLabel} sub={ACCESS[me.role]} />

          <Heading title="Commercial" />
          <Stack sx={{ gap: 1.25 }}>
            <SettingRow icon={<PaymentsRoundedIcon />} tint="#0A9A63" label="Admin fee" right={<Typography sx={{ fontWeight: 600 }}>S$3,500.00</Typography>} />
            <SettingRow icon={<SolarPowerRoundedIcon />} tint="#2A6FBF" label="Export credit" right={<Typography sx={{ fontWeight: 600 }}>SP Group · monthly</Typography>} />
          </Stack>

          <SignOutButton redirectUrl="/sign-in">
            <Button fullWidth size="large" variant="outlined" color="inherit" startIcon={<LogoutRoundedIcon />} sx={{ mt: 3 }}>
              Sign out
            </Button>
          </SignOutButton>
          <Typography variant="caption" sx={{ display: "block", textAlign: "center", color: "text.secondary", mt: 2 }}>
            GetHomeApps · 9 Solar Home
          </Typography>
        </Page>
      </Box>
    </>
  );
}
