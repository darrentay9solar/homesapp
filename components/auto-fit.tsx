"use client";

import { useEffect } from "react";

/**
 * Text that always fits the screen, whatever the phone and its font size.
 *
 * Phones differ in width (a 320px iPhone SE, a 412px Pixel 9) and people
 * enlarge text in their phone's settings (Android goes to 200%), so a line
 * that fits on one phone runs out of room on another. Every single-line
 * piece of text that would otherwise be cut short with "…" (names, dates,
 * chips, the bottom bar's labels, main buttons, anything marked data-fit) is watched here:
 *
 *   1. it fits: nothing changes;
 *   2. it doesn't: its font shrinks just enough to fit the whole text,
 *      down to MIN of its size (smaller isn't comfortable to read);
 *   3. still too long at that size: it wraps onto another line instead,
 *      so the whole sentence is always there.
 *
 * And when its neighbours (a picture, buttons) leave it only a sliver of a
 * very narrow phone, its row wraps and it keeps at least 120px (or the whole
 * line), so it's read on a line of its own rather than a letter at a time.
 *
 * It runs again when the screen turns or resizes, when fonts arrive, and
 * when anything on the page changes. data-nofit opts an element out.
 */

const TARGETS = [
  ".MuiTypography-noWrap",
  ".MuiChip-label",
  ".MuiBottomNavigationAction-label",
  ".MuiListItemText-primary",
  ".MuiInputLabel-root",
  ".MuiButton-sizeLarge",
  "[data-fit]",
].join(",");
const MIN = 0.7; // never below 70% of the designed size
const MIN_SHORT = 0.45; // the bottom bar's one-word labels can go further: five must share the width (180px at 200% text)
const BASE = "fitBase";

function isShort(el: HTMLElement): boolean {
  return el.classList.contains("MuiBottomNavigationAction-label");
}

function overflows(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1;
}

/** Back to the designed size, so a wider screen gets the full size back. */
function reset(el: HTMLElement) {
  el.style.removeProperty("font-size");
  if (el.dataset.fitWrapped) {
    el.style.removeProperty("white-space");
    el.style.removeProperty("text-overflow");
    el.style.removeProperty("overflow-wrap");
    const chip = el.closest<HTMLElement>(".MuiChip-root");
    if (chip) {
      chip.style.removeProperty("height");
      chip.style.removeProperty("padding-block");
    }
    delete el.dataset.fitWrapped;
  }
}

export function fit(el: HTMLElement) {
  if (el.closest("[data-nofit]") || !el.isConnected) return;
  // Sizes are measured as they are now: an animated font size (the bottom bar's
  // selected label grows) would be measured half-way and fit wrongly.
  el.style.setProperty("transition", "none", "important");
  reset(el);
  if (!el.clientWidth || !overflows(el)) return;
  const base = parseFloat(getComputedStyle(el).fontSize);
  el.dataset[BASE] = String(base);
  const floor = base * (isShort(el) ? MIN_SHORT : MIN);
  // Text width scales with the font, so one step lands close; a few more settle rounding.
  let size = Math.max(floor, (base * el.clientWidth) / el.scrollWidth);
  for (let i = 0; i < 4; i++) {
    el.style.setProperty("font-size", `${size.toFixed(2)}px`, "important");
    if (!overflows(el) || size <= floor) break;
    size = Math.max(floor, size * 0.96);
  }
  if (overflows(el) && !isShort(el)) {
    // Still too long at the smallest comfortable size: show it all, on two lines.
    el.style.setProperty("white-space", "normal", "important");
    el.style.setProperty("text-overflow", "clip", "important");
    el.style.setProperty("overflow-wrap", "anywhere", "important");
    const chip = el.closest<HTMLElement>(".MuiChip-root");
    if (chip) {
      chip.style.setProperty("height", "auto", "important");
      chip.style.setProperty("padding-block", "2px", "important");
    }
    el.dataset.fitWrapped = "1";
  }
}

// Rows and items changed to make room, so a wider screen can put them back.
const roomed: HTMLElement[] = [];

function squeezed(el: HTMLElement): boolean {
  const size = parseFloat(getComputedStyle(el).fontSize) || 14;
  return el.getClientRects().length > 0 && el.clientWidth < Math.max(48, size * 4) && overflows(el);
}

/** Lets the row holding a squeezed text wrap, and the text's place in it keep enough width. */
function makeRoom(el: HTMLElement) {
  // A chip's own row (its icon and label) isn't the one to wrap: start from the chip.
  const start = el.closest<HTMLElement>(".MuiChip-root") ?? el;
  for (let item: HTMLElement = start, row = start.parentElement; row && row !== document.body; item = row, row = row.parentElement) {
    const cs = getComputedStyle(row);
    if (cs.display.includes("flex") && cs.flexDirection.startsWith("row")) {
      if (cs.flexWrap === "nowrap") {
        row.style.setProperty("flex-wrap", "wrap", "important");
        roomed.push(row);
      }
      item.style.setProperty("min-width", "min(100%, 120px)", "important");
      roomed.push(item);
      return;
    }
  }
}

function putBack() {
  for (const e of roomed.splice(0)) {
    e.style.removeProperty("flex-wrap");
    e.style.removeProperty("min-width");
  }
}

export function fitAll(root: ParentNode = document) {
  putBack();
  const els = [...root.querySelectorAll<HTMLElement>(TARGETS)];
  els.forEach(reset);
  for (const el of els) if (!el.closest("[data-nofit]") && !isShort(el) && squeezed(el)) makeRoom(el);
  els.forEach(fit);
}

export function AutoFit() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitAll());
    };
    // The page's own changes (new screens, data arriving, a language switch). Our
    // own font-size changes are attribute changes, which aren't watched, so no loop.
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    void document.fonts?.ready.then(schedule);
    // For the design check and tests: fit now, after changing sizes by hand.
    (window as { __ghaFit?: () => void }).__ghaFit = () => fitAll();
    schedule();
    return () => {
      mo.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, []);
  return null;
}
