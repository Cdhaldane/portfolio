// Draws a night's wrap card (4:5, sized for group chats) in the style of
// the alley recap screen. Canvas, not a DOM screenshot, so the output is
// identical on every phone and needs no screenshot library.
import { formatNight } from "./bowlers";

const W = 1080;
const H = 1350;
const C = {
  bezel: "#121216",
  fieldA: "#7a4a2a",
  fieldB: "#4e2e1a",
  neon: "#43e46b",
  text: "#f4f1ff",
  outline: "#2c2a6b",
  gold: "#ffe45c",
  bar: "#2f63e6",
  cream: "#f5ecdc",
  soft: "#b9adc4",
  cha: "#2a9fd6",
  van: "#e85a48",
};

const DISPLAY = '"Bungee", "Space Grotesk", sans-serif';
const NEON = '"Monoton", "Bungee", sans-serif';
const BODY = '"Space Grotesk", system-ui, sans-serif';

async function ensureFonts() {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.all([
      document.fonts.load(`italic 60px ${DISPLAY}`),
      document.fonts.load(`64px ${NEON}`),
      document.fonts.load(`600 36px ${BODY}`),
    ]);
  } catch {
    /* fall back to system fonts; the card still draws */
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function outlined(ctx, text, x, y, fill = C.text) {
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  ctx.strokeStyle = C.outline;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function wrapText(ctx, text, maxWidth) {
  return text.split(" ").reduce(
    (lines, word) => {
      const last = lines[lines.length - 1];
      const trial = last ? `${last} ${word}` : word;
      return ctx.measureText(trial).width <= maxWidth
        ? [...lines.slice(0, -1), trial]
        : [...lines, word];
    },
    [""]
  );
}

function headline(bowlers) {
  if (bowlers.length === 1) return `${bowlers[0].name} bowled ${bowlers[0].total}`;
  const [a, b] = bowlers;
  if (a.total === b.total) return `Dead even at ${a.total}`;
  const w = a.total > b.total ? a : b;
  return `${w.name} takes it by ${Math.abs(a.total - b.total)}`;
}

function drawScreen(ctx, facts, x, y, w) {
  const rowH = 118;
  const headH = 96;
  const tableH = headH + rowH * facts.bowlers.length;
  const h = tableH + 200;

  roundRect(ctx, x, y, w, h, 28);
  const grad = ctx.createRadialGradient(x + w / 2, y + h * 0.4, 40, x + w / 2, y + h / 2, w * 0.75);
  grad.addColorStop(0, C.fieldA);
  grad.addColorStop(1, C.fieldB);
  ctx.fillStyle = grad;
  ctx.fill();

  // neon table
  const tx = x + 36;
  const ty = y + 40;
  const tw = w - 72;
  ctx.save();
  ctx.shadowColor = "rgba(67,228,107,0.55)";
  ctx.shadowBlur = 18;
  ctx.strokeStyle = C.neon;
  ctx.lineWidth = 5;
  roundRect(ctx, tx, ty, tw, tableH, 22);
  ctx.stroke();
  for (let i = 0; i < facts.bowlers.length; i += 1) {
    ctx.beginPath();
    ctx.moveTo(tx, ty + headH + rowH * i);
    ctx.lineTo(tx + tw, ty + headH + rowH * i);
    ctx.stroke();
  }
  ctx.restore();

  const cols = [tx + tw * 0.5, tx + tw * 0.64, tx + tw * 0.78, tx + tw - 28];
  ctx.textBaseline = "middle";
  ctx.font = `italic 40px ${DISPLAY}`;
  ctx.textAlign = "left";
  outlined(ctx, formatNight(facts.date, { month: "short", day: "numeric" }), tx + 26, ty + headH / 2);
  ctx.textAlign = "right";
  ["1st", "2nd", "3rd"].forEach((label, i) => outlined(ctx, label, cols[i], ty + headH / 2));
  outlined(ctx, "Total", cols[3], ty + headH / 2, C.gold);

  facts.bowlers.forEach((b, i) => {
    const cy = ty + headH + rowH * i + rowH / 2;
    ctx.fillStyle = C[b.key];
    ctx.beginPath();
    ctx.arc(tx + 42, cy, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.text;
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.font = `italic 50px ${DISPLAY}`;
    outlined(ctx, b.name, tx + 72, cy);
    ctx.textAlign = "right";
    ctx.font = `italic 58px ${DISPLAY}`;
    b.games.forEach((g, gi) => {
      const beat = b.priorAvg !== null && g > b.priorAvg;
      outlined(ctx, String(g), cols[gi], cy, beat ? C.text : "#d8d2ee");
    });
    outlined(ctx, String(b.total), cols[3], cy, C.gold);
  });

  // scanlines
  ctx.save();
  roundRect(ctx, x, y, w, h, 28);
  ctx.clip();
  ctx.fillStyle = "rgba(0,0,0,0.13)";
  for (let sy = y; sy < y + h; sy += 4) ctx.fillRect(x, sy, w, 1.5);
  ctx.restore();

  // footer bar
  const by = y + h - 110;
  ctx.save();
  roundRect(ctx, x, by, w, 110, 0);
  ctx.clip();
  const bar = ctx.createLinearGradient(x, 0, x + w, 0);
  bar.addColorStop(0, "#9dc4ff");
  bar.addColorStop(0.3, C.bar);
  bar.addColorStop(1, C.bar);
  ctx.fillStyle = bar;
  ctx.fillRect(x, by, w, 110);
  ctx.restore();
  ctx.textAlign = "left";
  ctx.font = `italic 44px ${DISPLAY}`;
  outlined(ctx, headline(facts.bowlers), x + 36, by + 55);

  return h;
}

/**
 * @param {ReturnType<import("./insights").wrapFacts>} facts
 * @returns {Promise<Blob>} a PNG
 */
export async function drawWrapCard(facts) {
  await ensureFonts();
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = C.bezel;
  ctx.fillRect(0, 0, W, H);
  // lane boards
  ctx.fillStyle = "rgba(140,90,255,0.05)";
  for (let bx = 0; bx < W; bx += 40) ctx.fillRect(bx, 0, 38, H);

  // neon sign
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `96px ${NEON}`;
  ctx.save();
  ctx.shadowColor = "#ff6a3d";
  ctx.shadowBlur = 34;
  ctx.fillStyle = "#ffe9a8";
  ctx.fillText("Bowler", W / 2, 150);
  ctx.restore();
  ctx.fillStyle = "#ffe9a8";
  ctx.fillText("Bowler", W / 2, 150);

  const screenH = drawScreen(ctx, facts, 60, 210, W - 120);

  // fact lines
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let fy = 210 + screenH + 90;
  facts.lines.forEach((line, i) => {
    ctx.font = `600 38px ${BODY}`;
    ctx.fillStyle = C[facts.bowlers[i].key];
    ctx.beginPath();
    ctx.arc(84, fy - 13, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.cream;
    wrapText(ctx, line, W - 180).forEach((l) => {
      ctx.fillText(l, 110, fy);
      fy += 52;
    });
    fy += 20;
  });

  ctx.font = `500 28px ${BODY}`;
  ctx.fillStyle = C.soft;
  ctx.textAlign = "center";
  ctx.fillText(
    formatNight(facts.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    W / 2,
    H - 60
  );

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the card."))), "image/png")
  );
}
