/*
 * What a callout says, shared by the host screen and every phone so the
 * room hears one story. Sober mode (drinking rules off) keeps the points
 * and drops the sips.
 */

export const money = (n) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US")}`;
const signed = (n) => (n > 0 ? `+${money(n)}` : money(n));
const sipWord = (n) => `${n} ${n === 1 ? "SIP" : "SIPS"}`;

const COPY = {
  score: (who, c) => ({ tone: "gold", title: "CORRECT!", line: `${who} ${signed(c.points)}` }),
  drink: (who, c, drinking) =>
    drinking
      ? { tone: "coral", title: `${who}, DRINK ${c.sips}`, line: `Wrong! ${money(c.points)}` }
      : { tone: "coral", title: "WRONG!", line: `${who} ${money(c.points)}` },
  everyone: (_who, c, drinking) =>
    drinking
      ? { tone: "coral", title: "NOBODY? EVERYBODY SIPS.", line: `${sipWord(c.sips)}, all round` }
      : { tone: "blue", title: "NOBODY GOT IT", line: "Moving on." },
  give: (who, c, drinking) =>
    drinking
      ? { tone: "gold", title: `${who} HANDS OUT ${sipWord(c.sips)}`, line: `Daily Double Shot! ${signed(c.points)}` }
      : { tone: "gold", title: "DAILY DOUBLE!", line: `${who} ${signed(c.points)}` },
  shot: (who, c, drinking) =>
    drinking
      ? { tone: "coral", title: `${who}, TAKE A SHOT`, line: `(or 5 sips) ${money(c.points)}` }
      : { tone: "coral", title: "DAILY DOUBLE, DENIED", line: `${who} ${money(c.points)}` },
  finish: (who, c, drinking) =>
    drinking
      ? { tone: "coral", title: `${who}, FINISH YOUR DRINK`, line: `Last Call, lost. ${money(c.points)}` }
      : { tone: "coral", title: "LAST CALL, LOST", line: `${who} ${money(c.points)}` },
};

/** { tone, title, line } for a callout, or null. `nameOf(pid)` resolves names. */
export function describeCallout(callout, nameOf, drinking = true) {
  if (!callout || !COPY[callout.kind]) return null;
  const who = callout.pid ? String(nameOf(callout.pid) || "Someone").toUpperCase() : "";
  return COPY[callout.kind](who, callout, drinking);
}

/** Does this callout mean the given player has to drink? */
const DRINKS = ["drink", "shot", "finish"];
export const callsOut = (callout, pid) =>
  Boolean(callout) && (callout.kind === "everyone" || (callout.pid === pid && DRINKS.includes(callout.kind)));

export const HOUSE_RULES = [
  { icon: "fa-beer-mug-empty", text: "Wrong answer? Drink the sips on the card: 1 to 3, bigger clues hurt more." },
  { icon: "fa-people-group", text: "Nobody gets it? Everybody sips." },
  { icon: "fa-bolt", text: "Daily Double Shot: nail it and hand out 3 sips. Blow it and take a shot (or 5 sips)." },
  { icon: "fa-circle-question", text: "Forget to phrase it as a question? Host's call. Usually a sip." },
  { icon: "fa-champagne-glasses", text: "Last Call: get it wrong and finish your drink." },
];
