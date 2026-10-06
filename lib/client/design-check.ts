/**
 * The design check: measures a rendered screen against the template in
 * design.ts and returns what doesn't match, in words. Runs in the browser on
 * a real page (the /dev-preview/design-check screen loads each screen in a
 * frame and calls these), so it checks what people actually see, not what
 * the code says.
 */

import { DESIGN } from "./design";

export type Kind = "app" | "auth";
export type Finding = { rule: string; detail: string };

const px = (v: string) => Math.round(parseFloat(v) * 10) / 10;
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0;
}

function label(el: Element): string {
  const t = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
  return t ? `"${t}"` : `<${el.tagName.toLowerCase()}>`;
}

/** Everything that doesn't match the template on this page. Empty means it all does. */
export function checkPage(win: Window, kind: Kind): Finding[] {
  const doc = win.document;
  const cs = (e: Element) => win.getComputedStyle(e);
  const all = (sel: string) => [...doc.querySelectorAll(sel)].filter(visible);
  const w = win.innerWidth;
  const desktop = w >= DESIGN.layout.desktopFrom;
  const out: Finding[] = [];
  const fail = (rule: string, detail: string) => out.push({ rule, detail });

  // ---- everywhere
  if (doc.documentElement.scrollWidth > w + 1) fail("No sideways scrolling", `page is ${doc.documentElement.scrollWidth}px wide in a ${w}px window`);

  const fonts = new Set(
    all("h1,h2,h3,p,span,button,input,textarea,label,li")
      .filter((e) => (e.textContent ?? "").trim() || e.tagName === "INPUT")
      .filter((e) => !e.closest(".sky-copy, .sky-clock, svg, [data-allow-font]"))
      .map((e) => cs(e).fontFamily.split(",")[0].replace(/["']/g, "").trim())
  );
  for (const f of fonts) if (!/poppins/i.test(f)) fail("Poppins everywhere", `found ${f}`);

  if (kind === "app") {
    // ---- green header
    const header = doc.querySelector("header");
    if (!header || !visible(header)) fail("Green wave header", "no page header");
    else {
      if (!cs(header).backgroundImage.includes(rgb(DESIGN.green.header))) fail("Green wave header", "header isn't the header-green gradient");
      if (!header.querySelector("svg path")) fail("Green wave header", "header has no wavy bottom edge");
      const h1 = header.querySelector("h1");
      const size = desktop ? DESIGN.type.pageTitle.desktop : DESIGN.type.pageTitle.phone;
      if (!h1) fail("Page title", "no title in the header");
      else if (!near(px(cs(h1).fontSize), size) || cs(h1).fontWeight !== "600") fail("Page title", `${px(cs(h1).fontSize)}px/${cs(h1).fontWeight}, should be ${size}px/600`);
    }

    // ---- section titles
    const st = desktop ? DESIGN.type.sectionTitle.desktop : DESIGN.type.sectionTitle.phone;
    for (const h2 of all("main h2, [data-layout=column] h2").filter((e) => !e.closest(".MuiDialog-root, .MuiCard-root"))) {
      if (!near(px(cs(h2).fontSize), st)) fail("Section title size", `${label(h2)} is ${px(cs(h2).fontSize)}px, should be ${st}px`);
    }
    for (const o of all(".MuiTypography-overline").filter((e) => !e.closest(".MuiCard-root, .MuiDialog-root"))) {
      fail("Capital labels only inside cards", `${label(o)} is used as a section title`);
    }

    // ---- column: header and content line up
    const hc = doc.querySelector("[data-layout=header-column]");
    const pc = doc.querySelector("[data-layout=column]");
    if (hc && pc && !doc.querySelector("[data-layout=column]")?.closest("[data-narrow]")) {
      const a = hc.getBoundingClientRect();
      const b = pc.getBoundingClientRect();
      if (b.width >= a.width - 2 && !near(a.left, b.left, 2)) fail("Header lines up with content", `header column at ${Math.round(a.left)}px, content at ${Math.round(b.left)}px`);
    }

    // ---- navigation
    const side = doc.querySelector("nav[aria-label=Main]");
    const bottom = doc.querySelector(".MuiBottomNavigation-root");
    if (desktop) {
      if (!side || !visible(side)) fail("Desktop: side menu", "side menu not showing");
      if (bottom && visible(bottom)) fail("Desktop: side menu", "bottom bar is showing on desktop");
    } else {
      if (!bottom || !visible(bottom)) fail("Phone: bottom bar", "bottom bar not showing");
      if (side && visible(side)) fail("Phone: bottom bar", "side menu is showing on a phone");
    }
  }

  if (kind === "auth") {
    if (desktop) {
      const side = doc.querySelector(".auth-side");
      if (!side || !visible(side)) fail("Desktop sign-in: sky on the left", "no sky panel");
      const main = doc.querySelector(".auth-main");
      if (main && cs(main).backgroundColor !== rgb(DESIGN.green.header)) fail("Desktop sign-in: green panel", `panel is ${cs(main).backgroundColor}, should be header green`);
      for (const b of all(".card-auth .btn.p")) {
        if (!near(px(cs(b).borderRadius), DESIGN.radius.button)) fail("Main button shape", `${label(b)} has ${cs(b).borderRadius} corners, should be ${DESIGN.radius.button}px`);
        const content = b.closest(".content");
        if (content && b.getBoundingClientRect().width < content.getBoundingClientRect().width - 2) fail("Main button full width", `${label(b)} doesn't fill the column`);
      }
    } else {
      const band = doc.querySelector(".band");
      if (!band || !visible(band)) fail("Phone sign-in: green wave header", "no header band");
      else {
        if (!band.querySelector("linearGradient")) fail("Phone sign-in: green wave header", "band isn't the header-green gradient");
        const h1 = band.querySelector("h1");
        if (h1 && !near(px(cs(h1).fontSize), DESIGN.type.dialogTitle)) fail("Header title", `${px(cs(h1).fontSize)}px, should be ${DESIGN.type.dialogTitle}px`);
      }
      for (const f of all(".af")) if (!near(px(cs(f).height), DESIGN.height.field)) fail("Field height", `${px(cs(f).height)}px, should be ${DESIGN.height.field}px`);
      for (const b of all(".btn.p")) {
        if (!near(px(cs(b).height), DESIGN.height.buttonLarge)) fail("Main button height", `${label(b)} is ${px(cs(b).height)}px, should be ${DESIGN.height.buttonLarge}px`);
        if (!near(px(cs(b).borderRadius), DESIGN.radius.buttonLarge)) fail("Main button shape", `${label(b)} has ${cs(b).borderRadius} corners`);
      }
    }
  }

  // ---- dialogs: green wave header, centred title, phone full screen
  for (const d of all(".MuiDialog-paper")) {
    if (!d.querySelector("svg linearGradient")) fail("Dialog: green wave header", "dialog has no header-green wave");
    const title = d.querySelector("svg + div p, svg ~ div .MuiTypography-root");
    if (title && !near(px(cs(title).fontSize), DESIGN.type.dialogTitle)) fail("Dialog title", `${label(title)} is ${px(cs(title).fontSize)}px, should be ${DESIGN.type.dialogTitle}px`);
    const r = d.getBoundingClientRect();
    if (w < 600 && (r.width < w - 1 || r.left > 1)) fail("Dialog: full screen on phones", `dialog is ${Math.round(r.width)}px wide in a ${w}px window`);
    if (w >= 600 && !near(px(cs(d).borderRadius), DESIGN.radius.dialog)) fail("Dialog corners", `${cs(d).borderRadius}, should be ${DESIGN.radius.dialog}px`);
  }

  // ---- MUI building blocks, wherever they appear
  for (const c of all(".MuiCard-root")) {
    if (!near(px(cs(c).borderRadius), DESIGN.radius.card)) fail("Card corners", `${label(c)} has ${cs(c).borderRadius}, should be ${DESIGN.radius.card}px`);
  }
  for (const c of all(".MuiChip-root")) {
    if (!near(px(cs(c).borderRadius), DESIGN.radius.chip)) fail("Chip corners", `${label(c)} has ${cs(c).borderRadius}`);
  }
  for (const b of all(".MuiButton-sizeLarge.MuiButton-contained")) {
    if (!near(px(cs(b).height), DESIGN.height.buttonLarge)) fail("Main button height", `${label(b)} is ${px(cs(b).height)}px`);
    if (!near(px(cs(b).borderRadius), DESIGN.radius.buttonLarge)) fail("Main button shape", `${label(b)} has ${cs(b).borderRadius} corners`);
    if (b.classList.contains("Mui-disabled") && b.classList.contains("MuiButton-colorPrimary")) {
      const bg = cs(b).backgroundColor;
      if (!(bg === rgb(DESIGN.green.light) || bg === rgb(DESIGN.green.dark))) fail("Disabled stays green", `${label(b)} is ${bg}`);
    }
  }
  for (const f of all(".MuiOutlinedInput-root:not(.MuiInputBase-multiline):not(.MuiInputBase-sizeSmall):not(.MuiAutocomplete-inputRoot)")) {
    if (f.closest(".MuiPickersInputBase-root, [data-allow-height]")) continue;
    const h = px(cs(f).height);
    if (!near(h, DESIGN.height.field, 1.5)) fail("Field height", `${label(f.closest(".MuiFormControl-root") ?? f)} is ${h}px, should be ${DESIGN.height.field}px`);
    if (!near(px(cs(f).borderRadius), DESIGN.radius.field)) fail("Field corners", `${cs(f).borderRadius}`);
  }

  // One finding per rule and detail.
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = f.rule + f.detail;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
