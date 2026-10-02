"use client";

/**
 * The 3D materials' colours, read from the design tokens rather than picked.
 *
 * Every colour in the hero scene is one of the custom properties declared in
 * src/app/globals.css. They are read off <html> at runtime with
 * getComputedStyle instead of being copied into this file, which means the
 * scene cannot drift from the palette the rest of the interface uses, and the
 * dark theme needs no second set of values: the same token names resolve to the
 * dark overrides the moment the attribute on <html> changes.
 */

export const HERO_TOKENS = [
  "--color-herb",
  "--color-drug",
  "--color-surface",
  "--color-paper",
  "--color-wash",
  "--color-line",
  "--color-ink",
  "--color-ink-2",
  "--color-mechanism",
] as const;

export type HeroToken = (typeof HERO_TOKENS)[number];
export type HeroPalette = Record<HeroToken, string>;

/**
 * Used only when a token resolves to nothing, which happens if the stylesheet
 * has not arrived yet. A single neutral grey rather than a copy of the palette:
 * a duplicated set of hex values here is exactly the thing that goes stale, and
 * one obvious grey is easier to spot than nine nearly-right colours.
 */
const UNRESOLVED = "#8a938f";

export function readPalette(element: HTMLElement): HeroPalette {
  const style = getComputedStyle(element);
  const palette = {} as HeroPalette;
  for (const token of HERO_TOKENS) {
    palette[token] = style.getPropertyValue(token).trim() || UNRESOLVED;
  }
  return palette;
}
