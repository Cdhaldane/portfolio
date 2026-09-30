/*
 * Dev-only guard for the likeliest 3D regression: a property that silently
 * flattens a preserve-3d chain. Every element marked `.td-3d` must stay free
 * of these; effects belong on leaf faces. Stripped from production builds.
 */

const FLATTENERS = [
  ["opacity", (v) => parseFloat(v) < 1],
  ["filter", (v) => v && v !== "none"],
  ["overflow", (v) => v && v !== "visible"],
  ["clip-path", (v) => v && v !== "none"],
  ["mask-image", (v) => v && v !== "none"],
  ["isolation", (v) => v === "isolate"],
  ["contain", (v) => v && v !== "none"],
];

export function assertPreserve3d(root) {
  if (process.env.NODE_ENV === "production" || !root || typeof getComputedStyle !== "function") {
    return;
  }
  root.querySelectorAll(".td-3d").forEach((el) => {
    const cs = getComputedStyle(el);
    FLATTENERS.forEach(([prop, bad]) => {
      const value = cs.getPropertyValue(prop);
      if (bad(value)) {
        // eslint-disable-next-line no-console
        console.warn(`[TopFive] ${prop}: ${value} flattens the 3D on`, el);
      }
    });
  });
}
