/**
 * The GetHomeApps design template, as numbers.
 *
 * Every screen — the account screens from Sign In to Request Access, and the
 * app from Projects to People and Audit — is built from these. The MUI theme
 * (mui-theme.ts), the shared components (components/topbar.tsx, m.tsx,
 * shell.tsx) and the account screens' CSS (globals.css) read them, and the
 * design check (/dev-preview/design-check) measures every screen against
 * them. Change a value here and everything follows; don't hard-code one
 * elsewhere.
 *
 * The rules in words, with pictures, are in docs/design/TEMPLATE.md and on
 * the live template page, /dev-preview/template.
 */

export const DESIGN = {
  /** 9 Solar Home green. */
  green: {
    /** Header green: the flat panel colour (desktop sign-in), and where every header gradient starts. */
    header: "#0E7F53",
    mid: "#0A5C3E",
    deep: "#073F2B",
    /** Accent in each theme: buttons, links, focused fields, progress. */
    light: "#0A9A63",
    dark: "#16C47F",
  },
  /** Every green header — page headers and dialog headers — is this gradient. */
  headerGradient: "linear-gradient(145deg, #0E7F53 0%, #0A5C3E 55%, #073F2B 100%)",

  /**
   * Titles on the page (section headings, card titles, the big numbers) are
   * painted with a gradient, deep to bright, left to right: green for titles,
   * the tile's own colour for a red or amber number. Each end keeps readable
   * contrast against its theme's card. Titles inside a green header stay white.
   */
  textGradient: {
    green: { light: "linear-gradient(95deg, #064D33 0%, #0A7D52 50%, #0C9C64 100%)", dark: "linear-gradient(95deg, #9AF5CF 0%, #3DDC97 45%, #16C47F 100%)" },
    red: { light: "linear-gradient(95deg, #8E1B1F 0%, #CE2E33 100%)", dark: "linear-gradient(95deg, #FFC2BD 0%, #F0736F 100%)" },
    amber: { light: "linear-gradient(95deg, #6E450B 0%, #B7791F 100%)", dark: "linear-gradient(95deg, #FFE0A3 0%, #E0A23A 100%)" },
  },

  font: "Poppins",

  /** Text sizes in px. */
  type: {
    pageTitle: { phone: 20, desktop: 24 },
    sectionTitle: { phone: 17, desktop: 19 },
    dialogTitle: 17,
    dialogHeading: { phone: 19, desktop: 21 },
    body: 14.5,
    caption: 12,
  },

  /** Corner rounding in px. */
  radius: {
    card: 18,
    dialog: 22,
    field: 10,
    button: 12,
    buttonLarge: 10,
    chip: 8,
    iconTile: 11,
    /** Search box and pill-tab track in a green header. */
    control: 12,
    /** A pill tab inside that track. */
    controlInner: 9,
    /** Menu rows, list rows, version rows. */
    listItem: 12,
  },

  /** Heights in px. */
  height: {
    field: 52,
    buttonLarge: 50,
    search: 40,
    tab: 32,
    bottomNav: 64,
  },

  layout: {
    /** At and above this width: side menu, split-screen sign-in, two cards per row. */
    desktopFrom: 1024,
    drawer: 268,
    /** The centred content column. */
    column: { desktop: 1160, wide: 1400 },
    /** Side gutter: phone, tablet, desktop. */
    gutter: { phone: 16, tablet: 24, desktop: 40 },
  },

  /**
   * Chart marks (the dashboard). Series 1 is the brand green, series 2 blue;
   * checked together for colour-blind separation and contrast against each
   * theme's card (dataviz validator, 9 Oct 2026). The dark green is a step
   * deeper than the dark accent, which is too bright for large marks.
   */
  chart: {
    series: [
      { light: "#0A9A63", dark: "#12A86C" },
      { light: "#2A78D6", dark: "#3987E5" },
    ],
  },

  /**
   * The energy flow's circles and lines, in FusionSolar's colours: PV amber, the grid purple, the
   * load blue, a battery green; each a step lighter on the dark theme.
   */
  flow: {
    pv: { light: "#C98A0B", dark: "#F2B544" },
    grid: { light: "#7C5CD6", dark: "#A78BFA" },
    load: { light: "#2A78D6", dark: "#3987E5" },
    battery: { light: "#0A9A63", dark: "#16C47F" },
  },

  /**
   * A project with an issue (late, a crew no-show): the whole card turns red,
   * not just its border, so it can't be missed in a list.
   */
  alarm: {
    light: { bg: "#FADADA", border: "#CE2E33" },
    dark: { bg: "#4A1A1C", border: "#F0736F" },
  },

  /** A colour per role, so lists of people read at a glance. */
  role: {
    homeowner: { light: "#2563EB", dark: "#60A5FA" },
    contractor: { light: "#B45309", dark: "#FBBF24" },
    epc_team: { light: "#7C3AED", dark: "#A78BFA" },
    project_manager: { light: "#0A9A63", dark: "#3DDC97" },
    superadmin: { light: "#BE123C", dark: "#FB7185" },
    finance: { light: "#0F766E", dark: "#5EEAD4" },
  },
} as const;
