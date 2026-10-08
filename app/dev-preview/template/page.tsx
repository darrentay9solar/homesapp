"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import BadgeRoundedIcon from "@mui/icons-material/BadgeRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type ReactNode, useState } from "react";

import { Field, MDialog, PhoneField, ROLE_NAME, RoleAvatar, RoleChip, SettingRow } from "@/components/m";
import { ProjectCard, ProgressRing, StatusChip, TimingChip } from "@/components/projects";
import { Page } from "@/components/shell";
import { MapView, type Pin } from "@/components/map";
import { EdgeCard, GRID, Heading, SearchBox, SegTabs, TopBar, roleColor } from "@/components/topbar";
import { useTab } from "@/lib/client/tabs";
import type { Role } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import type { ProjectRow } from "@/lib/client/projects";

/**
 * DEVELOPMENT ONLY. The design template, live: every building block from
 * docs/design/TEMPLATE.md drawn with the real components, so a change to a
 * component shows up here first. Switch Black/Light in Account to see both.
 */
// The template's parts are tabs too: categories go across, never down the page.
const PARTS = [
  ["colour", "Colour"],
  ["type", "Type"],
  ["fields", "Fields"],
  ["buttons", "Buttons"],
  ["chips", "Chips"],
  ["cards", "Cards"],
  ["feedback", "Feedback"],
  ["dialog", "Dialog"],
  ["account", "Account screens"],
  ["maps", "Maps"],
] as const;
type Part = (typeof PARTS)[number][0];
const PART_KEYS = PARTS.map(([k]) => k) as Part[];
const MAP_PINS: Pin[] = [
  { id: "s1", lat: 1.3521, lng: 103.8198, kind: "site", label: "Sunbird Circle" },
  { id: "s2", lat: 1.3966, lng: 103.873, kind: "site", label: "Jalan Kayu Residence" },
  { id: "p1", lat: 1.3329, lng: 103.7436, kind: "person", label: "Ravi Kumar", initials: "RK", color: "#7C3AED" },
];

export default function TemplatePage() {
  const [tab, setTab] = useTab(PART_KEYS, "colour");
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState(false);
  return (
    <>
      <TopBar
        title="Design template"
        sub="Every screen is built from these pieces"
        action={
          <Button startIcon={<AddRoundedIcon />} sx={{ color: "#073f2b", bgcolor: "#fff", px: 2, height: 36, "&:hover": { bgcolor: "#eafff4" } }}>
            Action
          </Button>
        }
        search={<SearchBox value={q} onChange={setQ} placeholder="Search box (40px, translucent)" />}
        tabs={<SegTabs label="Template parts" value={tab} onChange={setTab} options={PARTS.map(([value, label]) => ({ value, label }))} />}
      />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
            The rules are written out in docs/design/TEMPLATE.md; the numbers live in lib/client/design.ts. Open /dev-preview/design-check to measure every screen against them.
          </Typography>

          {tab === "colour" && (
            <>
            <Heading title="1 · Colour" />
            <Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "repeat(2, minmax(0,1fr))", lg: "repeat(4, minmax(0,1fr))" } }}>
              <Swatch bg={DESIGN.headerGradient} name="Header green" note="#0E7F53 → #0A5C3E → #073F2B, both themes" light />
              <Swatch bg="var(--mui-palette-primary-main)" name="Accent green" note="#0A9A63 Light · #16C47F Black" light />
              {(Object.keys(ROLE_NAME) as Role[]).map((r) => (
                <Swatch key={r} bg="" name={ROLE_NAME[r]} note={`${DESIGN.role[r].light} · ${DESIGN.role[r].dark}`} role={r} />
              ))}
              <Swatch bg="var(--mui-palette-error-main)" name="Needs attention" note="Late, no-show, declined" light />
              <Swatch bg="var(--mui-palette-warning-main)" name="Waiting" note="Awaiting approval or signature" light />
            </Box>
            </>
          )}
          {tab === "type" && (
            <>
            <Heading title="2 · Type" />
            <Card sx={{ p: 2.5 }}>
              <Stack sx={{ gap: 1.25 }}>
                <Sample k={`Page title · ${DESIGN.type.pageTitle.phone}/${DESIGN.type.pageTitle.desktop}px`}>
                  <Typography sx={{ fontWeight: 600, fontSize: { xs: DESIGN.type.pageTitle.phone, lg: DESIGN.type.pageTitle.desktop } }}>All Projects</Typography>
                </Sample>
                <Sample k={`Section title · ${DESIGN.type.sectionTitle.phone}/${DESIGN.type.sectionTitle.desktop}px`}>
                  <Typography sx={{ fontWeight: 600, fontSize: { xs: DESIGN.type.sectionTitle.phone, lg: DESIGN.type.sectionTitle.desktop } }}>Waiting for approval</Typography>
                </Sample>
                <Sample k={`Dialog heading · ${DESIGN.type.dialogHeading.phone}/${DESIGN.type.dialogHeading.desktop}px, green`}>
                  <Typography sx={{ fontWeight: 600, color: "primary.main", fontSize: { xs: DESIGN.type.dialogHeading.phone, sm: DESIGN.type.dialogHeading.desktop } }}>Create their login</Typography>
                </Sample>
                <Sample k="Body · 14.5px">
                  <Typography sx={{ fontSize: 14.5 }}>Panels installed and scaffolding removed.</Typography>
                </Sample>
                <Sample k="Caption · 12px, secondary">
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Progress is calculated by the system.
                  </Typography>
                </Sample>
                <Sample k="Label inside a card only (never a section title)">
                  <Typography variant="overline" sx={{ color: "text.secondary" }}>
                    Days running
                  </Typography>
                </Sample>
              </Stack>
            </Card>
            </>
          )}
          {tab === "fields" && (
            <>
            <Heading title="3 · Fields" />
            <Card sx={{ p: 2.5 }}>
              <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "minmax(0,1fr)", lg: "repeat(2, minmax(0,1fr))" } }}>
                <Field label="Text field" icon={<PersonOutlineRoundedIcon />} placeholder="Icon, label on the border, 52px" />
                <Field label="Email" type="email" required icon={<MailOutlineRoundedIcon />} placeholder="name@example.com" />
                <Field select label="Select" icon={<BadgeRoundedIcon />} value="epc_team">
                  {(Object.keys(ROLE_NAME) as Role[]).map((r) => (
                    <MenuItem key={r} value={r}>
                      {ROLE_NAME[r]}
                    </MenuItem>
                  ))}
                </Field>
                <PhoneField label="Mobile" value="+65 9123 4567" onChange={() => {}} helperText="Country code inside the field" />
                <Field label="Date" type="date" icon={<CalendarMonthRoundedIcon />} value="2026-10-19" onChange={() => {}} />
                <Field label="With a problem" error icon={<PersonOutlineRoundedIcon />} value="12345" helperText="Say what's wrong and what to do." onChange={() => {}} />
              </Box>
            </Card>
            </>
          )}
          {tab === "buttons" && (
            <>
            <Heading title="4 · Buttons" />
            <Card sx={{ p: 2.5 }}>
              <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "minmax(0,1fr)", lg: "repeat(2, minmax(0,1fr))" } }}>
                <Button size="large" variant="contained">
                  Main button · 50px
                </Button>
                <Button size="large" variant="contained" disabled>
                  Disabled stays dimmed green
                </Button>
                <Button size="large" variant="outlined" color="inherit">
                  Secondary
                </Button>
                <Button size="large" variant="contained" color="error">
                  Destructive
                </Button>
              </Box>
              <Stack direction="row" sx={{ gap: 1, mt: 2, flexWrap: "wrap", alignItems: "center" }}>
                <Button variant="contained">Small contained</Button>
                <Button variant="outlined">Outlined</Button>
                <Button>Text</Button>
                <Button size="small" variant="outlined" color="warning">
                  Revert
                </Button>
              </Stack>
            </Card>
            </>
          )}
          {tab === "chips" && (
            <>
            <Heading title="5 · Chips and avatars" />
            <Card sx={{ p: 2.5 }}>
              <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", alignItems: "center" }}>
                {(Object.keys(ROLE_NAME) as Role[]).map((r) => (
                  <RoleChip key={r} role={r} />
                ))}
                {(Object.keys(ROLE_NAME) as Role[]).map((r) => (
                  <RoleAvatar key={r} name={ROLE_NAME[r]} role={r} size={36} />
                ))}
              </Stack>
              <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", mt: 1.5 }}>
                <StatusChip p={{ status: "in_progress", statusLabel: "In Progress" }} />
                <StatusChip p={{ status: "awaiting_homeowner", statusLabel: "Awaiting Homeowner" }} />
                <StatusChip p={{ status: "homeowner_declined", statusLabel: "Homeowner Declined" }} />
                <StatusChip p={{ status: "draft", statusLabel: "Draft" }} />
                <TimingChip p={{ attention: false, flags: [] }} />
                <TimingChip p={{ attention: true, flags: [{ kind: "overdue", text: "" }] }} />
                <Chip size="small" variant="outlined" label="Milestone 2" />
              </Stack>
            </Card>
            </>
          )}
          {tab === "cards" && (
            <>
            <Heading title="6 · Cards" count={3} action={<Chip size="small" color="success" variant="outlined" label="Status chip on the right" />} />
            <Box sx={GRID}>
              <ProjectCard p={SAMPLE} />
              <EdgeCard color={roleColor("epc_team")}>
                <Box sx={{ p: 1.5, pl: 2.25, flex: 1 }}>
                  <Stack direction="row" sx={{ gap: 1.5, alignItems: "flex-start" }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        #0004
                      </Typography>
                      <Typography sx={{ fontWeight: 600, fontSize: 15.5 }}>Person card</Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary", fontSize: 13 }}>
                        Coloured edge = role colour
                      </Typography>
                    </Box>
                    <RoleAvatar name="Ravi Kumar" role="epc_team" size={42} />
                  </Stack>
                </Box>
              </EdgeCard>
              <Stack sx={{ gap: 1.25 }}>
                <SettingRow icon={<ShieldOutlinedIcon />} tint={DESIGN.role.contractor.light} label="Settings row" sub="Tinted icon tile, label, sub-line" />
                <SettingRow icon={<NotificationsRoundedIcon />} tint={DESIGN.role.homeowner.light} label="With a control" right={<Chip size="small" label="On" color="success" />} />
              </Stack>
              <Card sx={{ p: 4, textAlign: "center" }}>
                <SolarPowerRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
                <Typography sx={{ fontWeight: 600, mt: 1 }}>Empty state</Typography>
                <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                  Icon, one bold line, a short explanation, and the main action.
                </Typography>
                <Button variant="contained" startIcon={<AddRoundedIcon />} sx={{ mt: 2 }}>
                  Create project
                </Button>
              </Card>
            </Box>
            </>
          )}
          {tab === "feedback" && (
            <>
            <Heading title="7 · Progress and feedback" />
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "minmax(0,1fr)", lg: "auto minmax(0,1fr)" }, alignItems: "start" }}>
              <Card sx={{ p: 2.5, display: "flex", justifyContent: "center" }}>
                <ProgressRing value={62} />
              </Card>
              <Stack sx={{ gap: 1.25 }}>
                <Alert severity="error">Needs attention: red, with what happened.</Alert>
                <Alert severity="warning">Waiting on someone: amber.</Alert>
                <Alert severity="info">Information: blue.</Alert>
                <Alert severity="success">Done: green.</Alert>
              </Stack>
            </Box>
            </>
          )}
          {tab === "dialog" && (
            <>
            <Heading title="8 · Dialog" />
            <Card sx={{ p: 2.5 }}>
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
                Green wave header with back and title, centred green heading, fields, one main button and a caption. Full screen on phones.
              </Typography>
              <Button variant="contained" onClick={() => setDialog(true)}>
                Open the dialog template
              </Button>
            </Card>
            </>
          )}
          {tab === "account" && (
            <>
            <Heading title="9 · Account screens" />
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
              Phone: wavy green header, form below. Desktop: animated sky left, form on the green panel right.
            </Typography>
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "minmax(0,1fr)", lg: "auto minmax(0,1fr)" }, alignItems: "start" }}>
              <Frame src="/sign-in" w={375} h={720} scale={0.62} label="Phone · Sign In" />
              <Frame src="/sign-up" w={1440} h={900} scale={0.42} label="Desktop · Create Account" />
            </Box>
            </>
          )}
          {tab === "maps" && (
            <>
              <Heading title="10 · Maps" />
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
                OneMap: Night in Black, Default in Light. Sites are green dots that glow when picked; people are their avatar in their role colour; the phone is a blue dot. Every pin also has a card.
              </Typography>
              <MapView pins={MAP_PINS} picked="s1" me={{ lat: 1.3534, lng: 103.8198, accuracy: 30 }} height={360} testId="template-map" />
            </>
          )}
        </Page>
      </Box>

      {dialog && (
        <MDialog title="Dialog Title" heading="Centred green heading" subtitle="A short subtitle saying what this does." onClose={() => setDialog(false)}>
          <Stack sx={{ gap: 2.5 }}>
            <Field label="Full name" required icon={<PersonOutlineRoundedIcon />} placeholder="e.g. Aisha Rahman" />
            <PhoneField required value="" onChange={() => {}} />
          </Stack>
          <Button fullWidth size="large" variant="contained" disabled sx={{ mt: 3 }}>
            Main Button
          </Button>
          <Typography variant="caption" component="p" sx={{ textAlign: "center", color: "text.secondary", mt: 1.25 }}>
            One line: what happens next, or what&apos;s missing.
          </Typography>
        </MDialog>
      )}
    </>
  );
}

function Swatch({ bg, name, note, light, role }: { bg: string; name: string; note: string; light?: boolean; role?: Role }) {
  return (
    <Card sx={{ overflow: "hidden" }}>
      <Box sx={(t) => ({ height: 56, background: role ? (t.palette.mode === "dark" ? DESIGN.role[role].dark : DESIGN.role[role].light) : bg, color: light ? "#fff" : "inherit" })} />
      <Box sx={{ p: 1.25 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{name}</Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {note}
        </Typography>
      </Box>
    </Card>
  );
}

function Sample({ k, children }: { k: string; children: ReactNode }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0,1fr)", sm: "220px minmax(0,1fr)" }, gap: { xs: 0.25, sm: 2 }, alignItems: "baseline" }}>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {k}
      </Typography>
      {children}
    </Box>
  );
}

/** A real screen at real size, scaled down to fit. */
function Frame({ src, w, h, scale, label }: { src: string; w: number; h: number; scale: number; label: string }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 0.75 }}>
        {label}
      </Typography>
      <Box sx={{ width: w * scale, height: h * scale, maxWidth: "100%", overflow: "hidden", borderRadius: `${DESIGN.radius.card}px`, border: 1, borderColor: "divider" }}>
        <Box component="iframe" src={src} title={label} sx={{ width: w, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none" }} />
      </Box>
    </Box>
  );
}

const SAMPLE: ProjectRow = {
  id: 0,
  name: "Project card",
  address: "14 Jalan Kayu, Singapore 799463",
  postalCode: "799463",
  siteLocated: true,
  status: "in_progress",
  statusLabel: "In Progress",
  homeowner: { uid: 5, name: "Jasmine Lee", linked: true },
  contactNo: "+65 9123 4477",
  contractor: { type: "group", label: "Apex Solar Contractors", groupId: 1 },
  team: [
    { uid: 1, name: "Wei Ming Tan", role: "project_manager" },
    { uid: 3, name: "Priya Nair", role: "contractor" },
    { uid: 5, name: "Jasmine Lee", role: "homeowner" },
  ],
  pm: { uid: 1, name: "Wei Ming Tan" },
  startDate: "2026-10-05",
  endDate: "2026-10-26",
  daysElapsed: 3,
  progress: 40,
  milestone: 1,
  currentMilestone: 2,
  groups: {},
  flags: [],
  attention: false,
  createdAt: "2026-10-01T00:00:00Z",
};
