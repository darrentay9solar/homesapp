# GetHomeApps design template

Every screen follows this template: the account screens (Sign In, Create
Account, Forgot Password, Request Access) and the app (Projects, People,
Audit, Account, Alerts, Sites). It records what was agreed while building them.

- **Numbers** (colours, sizes, rounding, widths) live in one file,
  `lib/client/design.ts`. The MUI theme, the shared components and the
  account screens' CSS all read from it, so nothing is set twice.
- **Live template:** `/dev-preview/template` (development only) shows every
  piece below with the real components, in both themes.
- **Design check:** `/dev-preview/design-check` (development only) opens
  every screen at phone and desktop width, in Black and Light, measures it
  against this template, and lists anything that doesn't match. Run it
  after any change to a screen.

---

## 1. Foundations

| | Rule |
|---|---|
| **Font** | Poppins everywhere. The one exception is the sign-in sky's headline, which uses Fraunces ("Rooftop solar, *tracked to the day*"). |
| **Themes** | Black and Light. Chosen in Account → Appearance, remembered per device, and applied before the page draws. |
| **Header green** | `#0E7F53`, the same in both themes. Every green header is a gradient from it: `#0E7F53 → #0A5C3E → #073F2B`. A large flat green panel (desktop sign-in) is solid `#0E7F53`. |
| **Accent green** | Buttons, links, focused fields and progress: `#0A9A63` in Light, `#16C47F` in Black. |
| **Role colours** | Homeowner blue, Contractor Admin amber, EPC Team violet, Project Manager green. Used for avatars, role chips and a card's coloured edge, so lists of people read at a glance. |
| **Status colours** | Green on track, amber waiting, red needs attention (late, no-show, declined), blue for information. |

### Sizes

| Thing | Phone | Desktop |
|---|---|---|
| Page title (green header) | 20px, semibold | 24px, semibold |
| Section title | 17px, semibold | 19px, semibold |
| Dialog title (in its green wave) | 17px | 17px |
| Dialog heading (centred, green) | 19px | 21px |
| Field | 52px tall, 10px corners, label sitting on the border, icon at the start | same |
| Main button | 50px tall, 10px corners, full width | same |
| Other buttons | 12px corners | same |
| Card | 18px corners, 1px border | same |
| Chip | 8px corners | same |
| Icon tile (settings rows, kind icons) | 38px, 11px corners, tinted | same |

A **disabled** main button stays green, dimmed, never grey.

### Layout

| | Phone and tablet (under 1024px) | Desktop (1024px and up) |
|---|---|---|
| Navigation | Bottom bar | Side menu, 268px |
| Content | Full width, 16px side gutter (24px on tablets) | Centred column, up to 1160px (1400px on very wide screens), 40px gutter |
| Card lists | One card per row | Two cards per row |
| Dialogs | Full screen, slide up | Centred card |
| Account screens | Wavy green header, form below | Animated sky on the left, form directly on the green panel on the right |

No screen ever scrolls sideways.

---

## 2. Account screens (Sign In → Request Access)

- **Phone:** a wavy green header (lower on the left, rising to the right)
  with the back arrow, a centred title and the theme button. Below it: the
  logo, a centred green heading, a short subtitle, the fields, one main
  button, and a centred link line ("Already have an account? Sign in").
- **Desktop:** split screen. On the left, the animated sky: a 5-second sun
  cycle and streaming stars, with the clock pill and the Fraunces headline.
  On the right, the green panel, holding:
  - **Top bar:** back arrow (when there is somewhere to go back to), logo
    badge, and theme button on the right.
  - **Form:** sits directly on the green, with no card. White fields with
    the label on the border, and a white main button with green text.
- **Long forms** (Create Account, Request Access) use the compact column,
  420px wide and centred. Everything else is the same.
- Codes are six boxes. Passwords have a show/hide eye.

## 3. App screens (Projects, People, Audit, Account…)

Every app screen is built the same way, top to bottom:

1. **Green header** (`TopBar`). The header gradient, with a wavy bottom edge
   in the page colour. In order:
   - **Title row:**
     - back arrow (on a detail page)
     - title, with an optional second line (a role, an address)
     - one white action button ("Create project", "New account"), shortened to "New" on phones
     - the alerts bell
   - **Search box** (optional): translucent, 40px tall.
   - **Pill tabs** (optional): white pill on a dark track, each with a
     count. They slide sideways on phones.
2. **Section title** (`Heading`) with an optional count chip, and an action
   on the right (a button, or a status chip).
3. **Cards in a grid** (`GRID`): one per row on phones, two on desktop. A
   list card has a coloured left edge (`EdgeCard`): the role colour for
   people, red for anything needing attention, otherwise the status colour.
4. **Empty state:** a card with a green icon, a bold line, a short
   explanation, and the main action if there is one.
5. **Footnote** (optional): one centred caption line.

Small labels in capitals (overline) are only for naming a value inside a
card, such as "Status" or "Days running", never as a section title.

### Cards

- **Person card:**
  - ID, then name, email and mobile
  - role avatar on the right
  - footer with the role chip, groups and status
- **Project card:**
  - name, homeowner and contractor
  - team avatars
  - status, on time/late and milestone chips
  - start, target end and elapsed dates
  - progress bar
  - flags in red when it needs attention
- **Settings row** (`SettingRow`): tinted icon tile, label, sub-line, and
  an optional control on the right or below. Used in Account and in a
  person's Profile.
- **Timeline** (Audit):
  - a date rail on the left
  - a card per place per day: tinted shell, white card inside
  - version-history rows inside the card
  - changes shown line by line: old value struck through → new value

### Dialogs (`MDialog`)

Every dialog has the same parts, top to bottom:

- **Green wave header:** back arrow and centred title.
- **Heading and subtitle:** a centred green heading, with an optional subtitle.
- **Fields:**
  - each with an icon and the label on the border
  - mobile numbers use one field with the country code inside it ("SG +65 ▾ | 9123 4567")
- **Main button:** full width, dimmed green while it can't be pressed.
- **Caption:** one centred line under the button saying what happens next,
  or what's missing.

It's full screen on phones and a centred card on desktop. Anything that
changes data and can't be taken back shows a preview first. Reverts and
restores also need a written reason.

### Feedback

- Results of an action: a short toast at the bottom.
- Problems on a page: an inline alert (red for errors, amber for waiting,
  blue for information).
- Loading: placeholder shapes the size of what's coming.

---

## 4. Words

- Buttons say what they do: "Create Account", "Approve as EPC Team",
  "Restore". They're Title Case on the main button.
- Dates as Singapore writes them: "19 Oct 2026", "19 Oct 2026 14:05". Times
  are Singapore time, whatever the device says.
- Mobile numbers always carry their country code: "+65 9123 4567".
- Never say "error". Say what happened and what to do next.
