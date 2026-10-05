"use client";

import { SignOutButton } from "@clerk/nextjs";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

import { RoleAvatar, RoleChip, SectionTitle } from "@/components/m";
import { Header, Page } from "@/components/shell";
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

export default function AccountPage() {
  const me = useMe();
  const [theme, setTheme] = useTheme();
  if (!me) return null;
  return (
    <>
      <Header title="Account" />
      <Page narrow>
        <Card sx={{ p: 2.5, mt: 2 }}>
          <Stack direction="row" sx={{ gap: 2, alignItems: "center" }}>
            <RoleAvatar name={me.fullName ?? me.email} role={me.role} size={64} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" noWrap>
                {me.fullName ?? "—"}
              </Typography>
              <Box sx={{ my: 0.5 }}>
                <RoleChip role={me.role} />
              </Box>
              <Typography variant="body2" noWrap sx={{ color: "text.secondary" }}>
                {me.email}
                {me.contactNo ? ` · ${me.contactNo}` : ""}
              </Typography>
            </Box>
          </Stack>
        </Card>

        <SectionTitle title="Appearance" />
        <Card sx={{ p: 2 }}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            value={theme}
            onChange={(_, v) => v && setTheme(v)}
            aria-label="Appearance"
            sx={{ "& .MuiToggleButton-root": { gap: 1, py: 1.25, textTransform: "none", fontWeight: 600 } }}
          >
            <ToggleButton value="dark">
              <DarkModeRoundedIcon fontSize="small" /> Black
            </ToggleButton>
            <ToggleButton value="light">
              <LightModeRoundedIcon fontSize="small" /> Light
            </ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 1.25 }}>
            Light is easier to read on a rooftop in daylight; black saves battery indoors.
          </Typography>
        </Card>

        <SectionTitle title="Your access" />
        <Card sx={{ p: 2.5 }}>
          <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.75 }}>
            {ACCESS[me.role]}
          </Typography>
        </Card>

        <SectionTitle title="Commercial" />
        <Card sx={{ px: 2.5 }}>
          <Stack direction="row" sx={{ justifyContent: "space-between", py: 1.75 }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Admin fee
            </Typography>
            <Typography sx={{ fontWeight: 600 }}>S$3,500.00</Typography>
          </Stack>
          <Divider />
          <Stack direction="row" sx={{ justifyContent: "space-between", py: 1.75 }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Export credit
            </Typography>
            <Typography sx={{ fontWeight: 600 }}>SP Group · monthly</Typography>
          </Stack>
        </Card>

        <SignOutButton redirectUrl="/sign-in">
          <Button fullWidth size="large" variant="outlined" color="inherit" startIcon={<LogoutRoundedIcon />} sx={{ mt: 3 }}>
            Sign out
          </Button>
        </SignOutButton>
        <Typography variant="caption" sx={{ display: "block", textAlign: "center", color: "text.secondary", mt: 2 }}>
          GetHomeApps · 9 Solar Home
        </Typography>
      </Page>
    </>
  );
}
