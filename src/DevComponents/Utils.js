export const darkenColor = (color, percent) => {
  let r = parseInt(color.slice(1, 3), 16);
  let g = parseInt(color.slice(3, 5), 16);
  let b = parseInt(color.slice(5, 7), 16);

  r = Math.max(0, r - Math.floor((r * percent) / 100));
  g = Math.max(0, g - Math.floor((g * percent) / 100));
  b = Math.max(0, b - Math.floor((b * percent) / 100));

  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
};

export const extractHexColor = (color) => {
  const cssVar = color;
  const rootStyles = getComputedStyle(document.documentElement);
  return rootStyles.getPropertyValue(cssVar).trim();
};
