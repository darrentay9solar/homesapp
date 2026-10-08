# GetHomeApps design template

Every screen follows this template: the account screens (Sign In, Create
Account, Forgot Password, Request Access) and the app (Projects, People,
Audit, Account, Alerts, Sites). It records what was agreed while building them.

- **Built on Material UI.** Every screen, the account screens included, is
  made from MUI components and the shared pieces in `components/m.tsx`,
  `components/topbar.tsx` and `components/auth.tsx`. There is no
  screen-specific CSS: `app/globals.css` only holds resets.
- **Numbers** (colours, sizes, rounding, widths) live in one file,
  `lib/client/design.ts`. The MUI theme and the shared components read from
  it, so nothing is set twice.
- **Live template:** `/dev-preview/template` (development only) shows every
  piece below with the real components, in both themes.
- **Design check:** `/dev-preview/design-check` (development only) opens
  every screen and dialog at phone, tablet and desktop width, in Black and
  Light, in English and Chinese, measures it against this template, taps
  every date and time field to make sure its picker opens, and lists
  anything that doesn't match. Run it after any change to a screen.

---

## 1. Foundations

| | Rule |
|---|---|
| **Font** | Poppins everywhere. The one exception is the sign-in sky's headline, which uses Fraunces ("Rooftop solar, *tracked to the day*"). |
| **Themes** | Black and Light. Chosen in Account → Settings → Appearance, remembered per device, and applied before the page draws. |
| **Language** | English or Simplified Chinese. Chosen in Account → Settings → Language; kept with the account (so it follows the person to another phone) and in a cookie (so the first paint is already right). Chinese text falls back to Noto Sans SC / PingFang SC after Poppins. |
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
| Profile picture | Round; 84px on Account and a person's Profile, 32–42px in lists. Without one, the role-coloured initials | same |

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
- Built from `AuthShell` and its parts (`AuthHeading`, `AuthField`,
  `AuthButton`, …) in `components/auth.tsx`. Each part carries a
  `data-auth` marker the design check measures.

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
2. **Categories are tabs, never stacked.** A screen with more than one kind
   of thing (People: people, groups, requests, map; Account: profile,
   security, settings, access; a project: milestones, details, site visits)
   shows them as **pill tabs in the header**, one at a time. Never stack
   sections down the page under their own titles. The open tab is in the
   address (`?tab=groups`), so Back, refresh and alert links land on it
   (`useTab` in `lib/client/tabs.ts`). Filters within a tab (role, status)
   go in the header's filter button. At most one section title (`Heading`)
   shows at a time; the design check fails a screen with two. Dates in a
   timeline (Alerts' "Today", "Yesterday") are small labels, not titles.
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
- **Account** has four tabs: Profile, Security, Settings and Access.
  Settings holds Language and Appearance, each a **round swap button** on
  the right of its row (one tap swaps English ⇄ 简体中文, Light ⇄ Black; the
  same buttons sit in the account screens' header). It also has
  Notifications, Share my location, and, for project managers only, File
  storage, which answers just "File storage online" or "offline". Access
  lists what the role can and can't do, as points (`lib/client/access.ts`).
- **Maps** (`components/map.tsx`): OneMap's Night style in Black and Default
  in Light, in a card with 18px corners. Sites are green dots that glow when
  picked; people are their avatar in their role colour; the phone itself is
  a blue dot with its accuracy ring. A map is never the only way to act:
  each pin has a card under the map (swipe the cards and the map follows).
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
  - date and time fields use the phone's own picker, which opens from a tap
    anywhere on the field (the icon, the padding or the text), not only the
    small calendar mark
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
- Dates as Singapore writes them: "19 Oct 2026", "19 Oct 2026 14:05" (in
  Chinese, "2026年10月19日"). Times are Singapore time, whatever the device
  says.
- **Every word on a screen is translatable.** Write the English in the code
  wrapped in `T("…")` (with `{name}` blanks for values: `T("Approve as
  {role}", { role })`), and put the Chinese in `api/_lib/i18n/zh.json`.
  Text that comes from the server (messages, alert titles, field labels) is
  shown with `TR(text)`, which matches it against the same file, patterns
  included. The shared components (`TopBar`, `Heading`, `Field`,
  `MDialog`, `SettingRow`, `SegTabs`, `SearchBox`) translate their string
  props themselves. A unit test fails if any `T("…")` key has no Chinese.
- Never build a sentence from pieces ("1 change" + "s"): give each form its
  own key, so each language can say it its own way.
- Mobile numbers always carry their country code: "+65 9123 4567".
- Never say "error". Say what happened and what to do next.
