"use client";

import { useEffect } from "react";

/**
 * Text that always fits the screen, whatever the phone and its font size.
 *
 * Phones differ in width (a 320px iPhone SE, a 412px Pixel 9) and people
 * enlarge text in their phone's settings (Android goes to 200%), so a line
 * that fits on one phone runs out of room on another. Every single-line
 * piece of text that would otherwise be cut short with "…" (names, dates,
 * chips, the bottom bar's labels, anything marked data-fit) is watched here:
 *
 *   1. it fits: nothing changes;
 *   2. it doesn't: its font shrinks just enough to fit the whole text,
 *      down to MIN of its size (smaller isn't comfortable to read);
 *   3. still too long at that size: it wraps onto another line instead,
 *      so the whole sentence is always there.
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
  "[data-fit]",
].join(",");
const MIN = 0.7; // never below 70% of the designed size
const MIN_SHORT = 0.5; // the bottom bar's one-word labels can go further: five must share the width
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

export function fitAll(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(TARGETS).forEach(fit);
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
