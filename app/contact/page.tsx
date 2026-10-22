"use client";

import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import { ContactLinks, ContactNumbers } from "@/components/contact";
import { Logo } from "@/components/icons";
import { LangButton, ThemeButton } from "@/components/theme-button";
import { gradText } from "@/components/topbar";
import { T } from "@/lib/client/i18n";

/**
 * How to reach 9 Solar Home. Public: for people who aren't customers yet, or
 * can't sign in. Customers who are signed in find the same in Help.
 */
export default function ContactPage() {
  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default", px: 2, pt: 2, pb: 6 }}>
      <Box sx={{ maxWidth: 760, mx: "auto" }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap", mb: 2 }}>
          <Button component={Link} href="/sign-in" startIcon={<ArrowBackRoundedIcon />} sx={{ mr: "auto" }}>
            {T("Sign in")}
          </Button>
          <LangButton />
          <ThemeButton />
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, mb: 1 }}>
          <Logo size={40} />
          <Typography component="h1" variant="h5" sx={[{ minWidth: 0, overflowWrap: "anywhere" }, gradText()]}>
            {T("Contact 9 Solar Home")}
          </Typography>
        </Stack>
        <Typography sx={{ color: "text.secondary", mb: 3 }}>
          {T("Be a clean energy champion: transform your rooftop into a revenue engine today.")}
        </Typography>
        <Stack sx={{ gap: 1.5 }}>
          <ContactNumbers />
          <ContactLinks />
        </Stack>
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 3 }}>
          {T("Already a customer? Sign in to follow your project and ask questions in Help.")}{" "}
          <Box component={Link} href="/sign-in" sx={{ color: "primary.main", fontWeight: 600, textDecoration: "none" }}>
            {T("Sign in")}
          </Box>
        </Typography>
      </Box>
    </Box>
  );
}
