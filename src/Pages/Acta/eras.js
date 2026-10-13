// Era skins. A lesson's era sets the palette and the display face, so a week
// in Rome looks like Rome and a week in the Song dynasty looks like ink on
// paper. Each skin is one fixed look (not light/dark): the colours are chosen
// as a set and checked for contrast together.
//
// Only Literata (reading) and the current era's display face are fetched;
// IBM Plex Mono is already on every page.
import { useEffect } from "react";

export const ERAS = {
  ancient: {
    name: "Lapis and gold",
    bg: "#101a2c", bg2: "#18253b", fg: "#f0e7d2", soft: "#aaa48f", accent: "#d9b25a",
    font: '"Gloock", "Bodoni 72", Georgia, serif', family: "Gloock", scale: 0.94,
  },
  greece: {
    name: "Red-figure",
    bg: "#15100d", bg2: "#231913", fg: "#f2e4cf", soft: "#bba68c", accent: "#d9773d",
    font: '"GFS Didot", Didot, "Bodoni 72", Georgia, serif', family: "GFS Didot", scale: 1,
  },
  rome: {
    name: "Porphyry and gilt",
    bg: "#24101c", bg2: "#331727", fg: "#f5eadb", soft: "#c9b0a6", accent: "#d9b052",
    font: '"Marcellus", "Trajan Pro", Georgia, serif', family: "Marcellus", scale: 0.95,
  },
  byzantine: {
    name: "Mosaic",
    bg: "#0d1f24", bg2: "#14303a", fg: "#f1ead8", soft: "#a7b5ae", accent: "#e0b84c",
    font: '"Cormorant Garamond", Garamond, Georgia, serif', family: "Cormorant Garamond:wght@600", scale: 1.06,
  },
  medieval: {
    name: "Vellum and rubric",
    bg: "#eee2c6", bg2: "#e2d3ae", fg: "#2a1d11", soft: "#6a553d", accent: "#a3241b",
    font: '"IM Fell English", Garamond, Georgia, serif', family: "IM Fell English", scale: 1.02, light: true,
  },
  east: {
    name: "Ink and cinnabar",
    bg: "#f1ece2", bg2: "#e6dfd1", fg: "#1c1916", soft: "#675f55", accent: "#b2302a",
    font: '"Shippori Mincho", "Hiragino Mincho ProN", Georgia, serif', family: "Shippori Mincho:wght@600", scale: 0.94, light: true,
  },
  renaissance: {
    name: "Verdigris",
    bg: "#16282b", bg2: "#1f363a", fg: "#efe5d1", soft: "#a9b1a4", accent: "#d6a44e",
    font: '"EB Garamond", Garamond, Georgia, serif', family: "EB Garamond:wght@500", scale: 1.04,
  },
  revolutions: {
    name: "Laid paper",
    bg: "#f3efe6", bg2: "#e8e2d4", fg: "#191919", soft: "#5d5950", accent: "#24439a",
    font: '"Libre Caslon Display", Caslon, Georgia, serif', family: "Libre Caslon Display", scale: 1, light: true,
  },
  industrial: {
    name: "Soot and brass",
    bg: "#1b1d1d", bg2: "#262929", fg: "#e9e5db", soft: "#a7a396", accent: "#c99f4f",
    font: '"Abril Fatface", Didot, Georgia, serif', family: "Abril Fatface", scale: 0.84,
  },
  modern: {
    name: "Newsprint",
    bg: "#efede6", bg2: "#e3e0d6", fg: "#141414", soft: "#5a5853", accent: "#c8102e",
    font: '"Anton", "Arial Narrow", Impact, sans-serif', family: "Anton", scale: 0.9, light: true,
  },
};

export const DEFAULT_ERA = "greece";
export const eraOf = (era) => ERAS[era] || ERAS[DEFAULT_ERA];

/** CSS custom properties for a skin, spread onto the Acta root. */
export function skinVars(era) {
  const e = eraOf(era);
  return {
    "--ac-bg": e.bg,
    "--ac-bg2": e.bg2,
    "--ac-fg": e.fg,
    "--ac-soft": e.soft,
    "--ac-accent": e.accent,
    "--ac-display": e.font,
    "--ac-tscale": e.scale,
  };
}

const LITERATA = "family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400";

function fontHref(era) {
  const fam = eraOf(era).family.replace(/ /g, "+");
  return `https://fonts.googleapis.com/css2?${LITERATA}&family=${fam}&display=swap`;
}

/** Load Literata and the era's display face (once per era per tab). */
export function useEraFonts(era) {
  useEffect(() => {
    const id = `acta-font-${era || DEFAULT_ERA}`;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = fontHref(era || DEFAULT_ERA);
    document.head.appendChild(link);
  }, [era]);
}
