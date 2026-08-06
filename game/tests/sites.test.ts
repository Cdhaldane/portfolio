/*
 * Site and map-contract tests.
 *
 * GALLOWS_HYMN_MAPS.md §9 item 3 says, of the `groundHeight` change: "Write the
 * test first — 'a player standing at (x, z) under a deck whose y0 = 5.0 reports
 * ground 0.0' — then change it." That test is the first one below, and it was
 * written before the function was touched.
 *
 * The rest hold the authored maps to the same guarantees §11 forces on the
 * generator, because an authored map that breaks them is a content bug that
 * should fail in `node` rather than in someone's run.
 *
 *   node --experimental-strip-types --test tests/sites.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CMD, type Command, type TickInput } from "../src/sim/commands.ts";
import { deck, wallRun } from "../src/sim/kit.ts";
import {
  BOX,
  activeGates,
  buildLevel,
  cellOf,
  groundHeight,
  isPlaceable,
  tileOf,
  openBuilding,
  type Box,
} from "../src/sim/level.ts";
import { SITE, SITES, siteDef, siteForRound } from "../src/sim/sites.ts";
import { OPEN } from "../src/sim/undertown.ts";
import { SKY } from "../src/sim/atmosphere.ts";
import { pathSignature, tracePath } from "../src/sim/paths.ts";
import { ENEMIES, ENEMY } from "../src/sim/enemies.ts";
import { siteCanAnswer } from "../src/sim/systems/director.ts";
import { hashWorld } from "../src/sim/hash.ts";
import { step } from "../src/sim/step.ts";
import { PHASE, createWorld, roundQuota, type World } from "../src/sim/world.ts";
import { ticks } from "../src/sim/tuning.ts";

const EMPTY: Command[] = [];

/**
 * Move the player out of the lane.
 *
 * Every site's start is deliberately near the action, so a test player left
 * standing there is beaten to death long before a round clears. Standing still in
 * the lane being lethal is the feature (§21.3).
 */
function parkPlayer(w: World): void {
  w.player.x = 2;
  w.player.z = 2;
  w.player.px = 2;
  w.player.pz = 2;
}

function run(w: World, count: number, script?: (t: number) => Command[] | undefined): void {
  for (let i = 0; i < count; i++) {
    const cmds = script?.(w.tick) ?? EMPTY;
    const input: TickInput = { tick: w.tick, playerId: 0, cmds };
    step(w, input);
    w.events.clear();
  }
}

describe("groundHeight respects y0 (MAPS §9 item 3)", () => {
  /** A tiny synthetic level: floor at 0, a catwalk 5m up over part of it. */
  function levelWithCatwalk() {
    const level = buildLevel(SITE.bootHill);
    const boxes: Box[] = [];
    deck(boxes, 10, 10, 6, 6, 5.0);
    level.boxes = boxes;
    return level;
  }

  it("reports ground 0 for a body standing UNDER a raised deck", () => {
    // The exact case from the doc. Before the fix this returned 5.0 and teleported
    // the player onto the catwalk, which is why decks could not exist.
    const level = levelWithCatwalk();
    assert.equal(groundHeight(level, 10, 10, 0.35), 0);
  });

  it("reports the deck for a body standing ON it", () => {
    const level = levelWithCatwalk();
    assert.equal(groundHeight(level, 10, 10, 5.35), 5.0);
  });

  it("still refuses to snap a body onto a wall it is brushing", () => {
    const level = buildLevel(SITE.bootHill);
    const boxes: Box[] = [];
    wallRun(boxes, 0, 10, 20, 10);
    level.boxes = boxes;
    assert.equal(groundHeight(level, 10, 10, 0.35), 0, "a 4m wall is not ground");
  });
});

describe("isPlaceable keys off kind, not height (MAPS §9 item 4)", () => {
  it("allows a trap on a 0.30m boardwalk", () => {
    const level = buildLevel(SITE.creekPinch);
    // The retained M0 site carries one deck at (20, 17) for exactly this reason.
    const cell = tileOf(level, 20, 17);
    const onDeck = level.boxes.some(
      (b) => b.kind === BOX.deck && 20 >= b.x0 && 20 <= b.x1 && 17 >= b.z0 && 17 <= b.z1,
    );
    assert.ok(onDeck, "the fixture needs a deck at (20, 17)");
    assert.equal(isPlaceable(level, cell), true, "boardwalks must be buildable");
  });

  it("still refuses the player's plinth and its steps", () => {
    // The plinth is a deck too, so this cannot key off kind alone — the map marks
    // it `noBuild`, because whether high ground is a firing position or a trap bed
    // is an authoring decision (MAPS §4 "What could go wrong").
    const level = buildLevel(SITE.creekPinch);
    assert.equal(isPlaceable(level, tileOf(level, 10, 11)), false, "the plinth");
    assert.equal(isPlaceable(level, tileOf(level, 15, 11)), false, "its steps");
  });
});

describe("every authored site holds §11's guarantees", () => {
  for (const site of SITES) {
    describe(site.name, () => {
      const level = buildLevel(site.id);

      it("G6 — the Rift cell is unblocked", () => {
        // §21.1 note 3: the Rift is the flow field's only source. Block it and
        // every cell becomes unreachable, silently.
        const rc = cellOf(level, level.rift.x, level.rift.z);
        assert.equal(level.blocked[rc], 0);
        assert.equal(level.dist[rc], 0);
      });

      it("G2 — no trap may be placed in the Rift ring", () => {
        assert.equal(isPlaceable(level, tileOf(level, level.rift.x, level.rift.z)), false);
      });

      it("G3/G4 — every gate reaches the Rift, and no path is under 18m", () => {
        for (const gate of level.gates) {
          const c = cellOf(level, gate.x, gate.z);
          assert.ok(c >= 0, `gate (${gate.x}, ${gate.z}) is off the grid`);
          assert.ok(
            Number.isFinite(level.dist[c]),
            `gate (${gate.x}, ${gate.z}) is walled off from the Rift`,
          );
          /*
           * The 18m rule takes an **exemption list, not an exception**: a gate may
           * be short only if the player had to buy it, and the assertion below
           * names the one that qualifies. A second short gate cannot appear by
           * accident, because it would have to be added here first — which is the
           * whole difference between a documented design break and a bug.
           */
          if (gate.requiresOpen !== undefined) {
            assert.equal(
              `${site.key}:${gate.requiresOpen}`,
              "undertown:4",
              "the Undertown's Breach is the only gate allowed to be short",
            );
            continue;
          }
          assert.ok(
            level.dist[c] >= 18,
            `gate (${gate.x}, ${gate.z}) path is ${level.dist[c].toFixed(1)}m, under 18m`,
          );
        }
      });

      it("the flow field leads every gate home", () => {
        for (const gate of level.gates) {
          let x = gate.x;
          let z = gate.z;
          let reached = false;
          for (let i = 0; i < 600; i++) {
            const c = cellOf(level, x, z);
            assert.ok(c >= 0, "walked off the grid");
            const dx = x - level.rift.x;
            const dz = z - level.rift.z;
            if (Math.sqrt(dx * dx + dz * dz) <= level.rift.radius) {
              reached = true;
              break;
            }
            assert.ok(
              level.flowX[c] !== 0 || level.flowZ[c] !== 0,
              `dead cell at (${x.toFixed(1)}, ${z.toFixed(1)})`,
            );
            x += level.flowX[c] * 0.5;
            z += level.flowZ[c] * 0.5;
          }
          assert.ok(reached, `gate (${gate.x}, ${gate.z}) never reaches the Rift`);
        }
      });

      it("leaves a usable amount of buildable floor", () => {
      // Build tiles, not nav cells: `isPlaceable` is a tile query (sim/level.ts).
      const tiles = level.tw * level.th;
      let n = 0;
      for (let i = 0; i < tiles; i++) if (isPlaceable(level, i)) n++;
        assert.ok(n > 60, `only ${n} placeable tiles`);
      });

      it("declares a census that matches its own claims", () => {
        const c = level.census;
        assert.ok(c.floor > 0 && c.sigil >= 0 && c.ceiling >= 0 && c.wall >= 0);
        // Boot Hill is floor-only *on purpose*, and the census has to say so or
        // the director cannot protect it.
        if (site.id === SITE.bootHill) {
          assert.ok(c.wall <= 4, "Boot Hill must stay floor-only");
          assert.equal(c.ceiling, 1, "one ceiling anchor: the hanging tree");
        }
      });
    });
  }
});

describe("Boot Hill teaches in the order MAPS §4 claims", () => {
  const level = buildLevel(SITE.bootHill);

  it("owns rounds 1–3, and hands over after", () => {
    assert.equal(siteForRound(1), SITE.bootHill);
    assert.equal(siteForRound(3), SITE.bootHill);
    assert.notEqual(siteForRound(4), SITE.bootHill);
  });

  it("round 1 opens one gate; round 3 opens the second", () => {
    assert.equal(activeGates(level, 1).length, 1, "one lane to learn on");
    assert.equal(activeGates(level, 2).length, 1);
    assert.equal(activeGates(level, 3).length, 2, "the north gate opens at 3");
  });

  it("the pinch is wider than a single Tar Seep can seal", () => {
    // §21.2 note 2, kept on purpose: coverage is the player's problem. The gap
    // spans z 14–18 at x=30, and a 1.5m-radius pool cannot cover 4m.
    let open = 0;
    for (let z = 12; z <= 20; z++) {
      if (!level.blocked[cellOf(level, 30.5, z + 0.5)]) open++;
    }
    // The fence gap is 4m of geometry, but `blocked` is inflated by the agent
    // radius (0.45m) on each side, leaving ~3.1m walkable and exactly 2 cells a
    // trap may occupy. A Tar Seep is 1.5m radius — 3m across — so one pool still
    // cannot seal it, which is the whole point (§21.2 note 2).
    assert.equal(open, 2, `expected a 2-cell pinch, found ${open}`);
    const walkable = open * level.cell + 2 * (1 - 0.45);
    assert.ok(walkable > 3.0, `walkable ${walkable}m must exceed one Tar diameter`);
  });

  it("keeps the second route the loop depends on", () => {
    // The fence stops at z=26; south of it there must be a way around.
    const southOfFence = cellOf(level, 30.5, 29.5);
    assert.equal(level.blocked[southOfFence], 0, "the southern loop must stay open");
    assert.ok(Number.isFinite(level.dist[southOfFence]));
  });
});

describe("composition constraint #6 — the site must be able to answer (MAPS §3 G7)", () => {
  it("caps Buzzards against the site's ceiling anchors", () => {
    const w = createWorld(1, SITE.bootHill);
    const buzzard = ENEMIES[ENEMY.buzzard];
    // Boot Hill has one anchor, so the cap is two.
    assert.equal(siteCanAnswer(buzzard, w), true, "the first is allowed");
    w.spawnedByDef[ENEMY.buzzard] = 2;
    assert.equal(siteCanAnswer(buzzard, w), false, "the third is not");
  });

  it("never bars the horde filler, which every map can answer", () => {
    const w = createWorld(1, SITE.bootHill);
    w.spawnedByDef[ENEMY.dustkin] = 999;
    assert.equal(siteCanAnswer(ENEMIES[ENEMY.dustkin], w), true);
  });

  it("bars an archetype whose answer the site does not have", () => {
    // A hypothetical Rattler: invalidates floor traps, needs vertical surfaces.
    const w = createWorld(1, SITE.bootHill);
    const rattler = { ...ENEMIES[ENEMY.dustkin], requires: { verticalSurfaces: 8 } };
    assert.equal(
      siteCanAnswer(rattler, w),
      false,
      "Boot Hill has 4 vertical faces; a Rattler here has no answer",
    );
  });

  it("the director still fills a round when everything else is barred", () => {
    const w = createWorld(2, SITE.bootHill);
    w.round = 5;
    w.spawnedByDef[ENEMY.buzzard] = 99;
    w.spawnedByDef[ENEMY.ironjaw] = 0;
    run(w, 1, () => [{ t: CMD.startWave }]);
    for (let i = 0; i < ticks(60) && w.spawnedThisWave < 5; i++) run(w, 1);
    assert.ok(w.spawnedThisWave > 0, "a barred roster must not stall the round");
  });
});

describe("travelling between sites", () => {
  it("moves to the next site when the round crosses over, refunding the build", () => {
    const w = createWorld(9, SITE.bootHill);
    parkPlayer(w);
    w.round = 3;
    w.roundQuota = roundQuota(3);
    w.scrap = 1000;

    // Buy something, so the refund has work to do.
    const cell = tileOf(w.level, 20, 20);
    run(w, 1, () => [{ t: CMD.selectSlot, slot: 0 }, { t: CMD.place, cell }]);
    const placed = w.traps.count;
    assert.equal(placed, 1, "the fixture needs a trap to refund");
    const afterBuying = w.scrap;

    run(w, 1, () => [{ t: CMD.startWave }]);
    for (let i = 0; i < ticks(240) && w.round === 3; i++) run(w, 1);

    assert.equal(w.round, 4, "round 3 should have cleared");
    assert.equal(w.level.siteId, SITE.undertown, "and we should have travelled");
    assert.equal(w.traps.count, 0, "traps are bolted to a floor we have left");
    assert.ok(w.scrap > afterBuying, "but the scrap comes back");
    assert.equal(w.siteJustChanged, true);
  });

  it("puts the player at the new site's start, not the old coordinates", () => {
    const w = createWorld(10, SITE.bootHill);
    parkPlayer(w);
    w.round = 3;
    w.roundQuota = roundQuota(3);
    run(w, 1, () => [{ t: CMD.startWave }]);
    for (let i = 0; i < ticks(240) && w.round === 3; i++) run(w, 1);

    assert.equal(w.level.siteId, SITE.undertown);
    assert.equal(w.player.x, w.level.playerStart.x);
    assert.equal(w.player.z, w.level.playerStart.z);
    assert.ok(w.player.x <= w.level.width, "and inside the new bounds");
    assert.equal(w.phase, PHASE.build, "arriving hands control back");
  });

  it("stays deterministic across a transition", () => {
    const script = (t: number): Command[] | undefined => {
      // Computed, not a literal: 900 was a nav cell, and it is off the end of the
      // 384-tile build grid entirely.
      if (t === 2)
        return [
          { t: CMD.selectSlot, slot: 1 },
          { t: CMD.place, cell: tileOf(a.level, 27, 17) },
        ];
      if (t === 5) return [{ t: CMD.buildMode, on: false }];
      if (t === 8) return [{ t: CMD.startWave }];
      if (t % 53 === 0) return [{ t: CMD.fire }];
      return undefined;
    };
    const a = createWorld(0xfeed, SITE.bootHill);
    const b = createWorld(0xfeed, SITE.bootHill);
    // Parked, for the same reason as above: Boot Hill's start is *in* the lane,
    // and a player who stands there is beaten to death before the round clears.
    parkPlayer(a);
    parkPlayer(b);
    a.round = 3;
    b.round = 3;
    a.roundQuota = roundQuota(3);
    b.roundQuota = roundQuota(3);
    run(a, ticks(420), script);
    run(b, ticks(420), script);
    assert.equal(hashWorld(a), hashWorld(b));
    assert.ok(a.round > 3, "and the run should have progressed past the transition");
  });
});

/*
 * The Undertown's geometry is not constant, which makes it the only site where
 * the level-guarantee tests have to hold over a *set* of states rather than one.
 * Six buildings is 64 combinations — small enough to check exhaustively, and the
 * combination is exactly where the bug will be (MAPS §11).
 */
describe("Hollow Creek, Undertown — the Boarding", () => {
  const def = siteDef(SITE.undertown);

  /** A level rebuilt around an explicit open-set. */
  const at = (open: boolean[]) => {
    const l = buildLevel(SITE.undertown);
    for (let i = 0; i < open.length; i++) if (open[i]) openBuilding(l, i);
    return l;
  };
  const none = () => [false, false, false, false, false, false];
  const only = (...ids: number[]) => {
    const o = none();
    for (const i of ids) o[i] = true;
    return o;
  };
  const gateDist = (l: ReturnType<typeof buildLevel>, x: number, z: number) =>
    l.dist[cellOf(l, x, z)];

  it("holds every level guarantee in all 64 combinations", () => {
    for (let mask = 0; mask < 64; mask++) {
      const l = at([0, 1, 2, 3, 4, 5].map((i) => (mask & (1 << i)) !== 0));
      const rc = cellOf(l, l.rift.x, l.rift.z);
      assert.equal(l.blocked[rc], 0, `mask ${mask}: the Rift cell got blocked`);

      for (const g of l.gates) {
        // The Breach is the one declared exemption from the 18m rule, and it is
        // only live once the Jail is bought. Naming it here is what stops a
        // second short gate appearing by accident.
        if (g.requiresOpen !== undefined) {
          assert.equal(g.requiresOpen, OPEN.jail, "only the Jail may exempt a gate");
          if (!l.open[g.requiresOpen]) continue;
          assert.ok(gateDist(l, g.x, g.z) < 18, "the Breach is supposed to be short");
          continue;
        }
        const d = gateDist(l, g.x, g.z);
        assert.ok(Number.isFinite(d), `mask ${mask}: gate (${g.x},${g.z}) walled off`);
        assert.ok(d >= 18, `mask ${mask}: gate (${g.x},${g.z}) path ${d} < 18m`);
      }
    }
  });

  it("seals the north alley until a building is opened", () => {
    const shut = at(none());
    assert.ok(
      !Number.isFinite(shut.dist[cellOf(shut, 40, 3)]),
      "the alley is dead service space behind a continuous row",
    );
    const open = at(only(OPEN.assay));
    assert.ok(
      Number.isFinite(open.dist[cellOf(open, 40, 3)]),
      "the Assay's broken window is a way in",
    );
  });

  /*
   * The measurement that caught the original design being wrong. The first draft
   * claimed an "alley rule" where two doors made a bypass lane; a probe showed
   * every gate distance identical across all 64 states, because a shortest-path
   * field never takes the longer route. The throat and the plaza-flank doors are
   * the fix, and this test is what stops them being quietly undone.
   */
  it("the Rows and the saloon MOVE the lane; the alley doors do not", () => {
    const base = at(none());
    const west = gateDist(base, 3, 24);
    const east = gateDist(base, 77, 24);
    const fall = gateDist(base, 71, 37);

    const rows = at(only(OPEN.paupers));
    assert.ok(
      gateDist(rows, 3, 24) < west - 1,
      "opening the Rows must give the west drift a cheaper way in",
    );

    const saloon = at(only(OPEN.saloon));
    assert.ok(gateDist(saloon, 77, 24) < east - 1, "the saloon re-routes the Long Adit");
    assert.ok(gateDist(saloon, 71, 37) < fall - 1, "and the Fall with it");

    // The three alley doors are player infrastructure, not lanes, and the map's
    // costs are documented on that basis. If this ever starts failing, the doc
    // is wrong, not the test.
    for (const id of [OPEN.chapel, OPEN.assay, OPEN.fetch]) {
      const l = at(only(id));
      assert.equal(gateDist(l, 3, 24), west, "alley doors do not move the crowd");
      assert.equal(gateDist(l, 77, 24), east);
    }
  });

  it("only opens the Breach once the Jail is bought", () => {
    const shut = at(none());
    assert.equal(activeGates(shut, 9).some((g) => g.requiresOpen !== undefined), false);
    const jail = at(only(OPEN.jail));
    const breach = activeGates(jail, 9).find((g) => g.requiresOpen !== undefined);
    assert.ok(breach, "the Debt leaves a hole and the hole stays");
    assert.ok(gateDist(jail, breach.x, breach.z) < 18);
  });

  it("charges once, and rebuilding is deterministic", () => {
    const l = at(none());
    const cost = openBuilding(l, OPEN.saloon);
    assert.equal(cost, def.openables?.[OPEN.saloon].cost);
    assert.equal(openBuilding(l, OPEN.saloon), 0, "already open, so free");

    // Same open-set → identical field, whatever order it was bought in.
    const a = at(only(OPEN.saloon, OPEN.paupers));
    const b = at(only(OPEN.paupers, OPEN.saloon));
    assert.deepEqual(Array.from(a.dist), Array.from(b.dist));
    assert.deepEqual(Array.from(a.blocked), Array.from(b.blocked));
  });

  it("declares a census that matches the floor it actually has", () => {
    const l = buildLevel(SITE.undertown);
    let placeable = 0;
    const tiles = l.tw * l.th;
    for (let i = 0; i < tiles; i++) if (isPlaceable(l, i)) placeable++;
    // Within 25%: the census is a design contract the director reads, so it may
    // round, but it may not drift into fiction.
    assert.ok(
      Math.abs(placeable - l.census.floor) / l.census.floor < 0.25,
      `census claims ${l.census.floor} floor cells, the map has ${placeable}`,
    );
  });

  it("is sealed rock overhead, and says so", () => {
    const l = buildLevel(SITE.undertown);
    assert.equal(l.atmosphere.sky, SKY.cavern);
    assert.equal(l.atmosphere.moon, 0, "no moon thirty metres down");
    assert.ok(l.atmosphere.roof > 0, "ceiling traps need something to bolt to");
    assert.ok(l.census.ceiling > 10, "the roof is the reason this map exists");
  });
});

/*
 * The build-phase route preview (§4). Its entire value is that it is *honest* —
 * a drawn path that disagrees with where the bodies actually walk is worse than
 * no path at all, because the player will build against it.
 */
describe("ghost paths — what the build phase promises", () => {
  const nearRift = (l: ReturnType<typeof buildLevel>, x: number, z: number) =>
    Math.hypot(x - l.rift.x, z - l.rift.z) <= l.rift.radius + 0.01;

  for (const site of SITES) {
    it(`${site.name}: every active gate's path arrives at the Rift`, () => {
      const level = buildLevel(site.id);
      for (const gate of activeGates(level, 99)) {
        const pts: number[] = [];
        const n = tracePath(level, gate.x, gate.z, pts);
        assert.ok(n >= 2, `gate (${gate.x},${gate.z}) traced nothing`);

        // Starts where the bodies start and ends where they are going.
        assert.equal(pts[0], gate.x);
        assert.equal(pts[1], gate.z);
        assert.ok(
          nearRift(level, pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]),
          `gate (${gate.x},${gate.z}) path stops short of the Rift`,
        );
      }
    });

    it(`${site.name}: no drawn path crosses a wall`, () => {
      const level = buildLevel(site.id);
      for (const gate of activeGates(level, 99)) {
        const pts: number[] = [];
        const n = tracePath(level, gate.x, gate.z, pts);
        for (let i = 0; i < n; i++) {
          const x = pts[i * 2];
          const z = pts[i * 2 + 1];
          // The last point is the Rift centre itself, which is legitimately
          // inside the objective ring rather than on open floor.
          if (i === n - 1) continue;
          const c = cellOf(level, x, z);
          assert.ok(c >= 0, `path left the map at (${x}, ${z})`);
          assert.equal(
            level.blocked[c],
            0,
            `path runs through blocked geometry at (${x.toFixed(1)}, ${z.toFixed(1)})`,
          );
        }
      }
    });
  }

  it("is deterministic — the same field traces the same line", () => {
    const a: number[] = [];
    const b: number[] = [];
    const l1 = buildLevel(SITE.undertown);
    const l2 = buildLevel(SITE.undertown);
    tracePath(l1, 3, 24, a);
    tracePath(l2, 3, 24, b);
    assert.deepEqual(a, b);
  });

  /*
   * The one that matters on Hollow Creek. Buying a building re-routes the crowd,
   * and if the preview did not follow, a 100-scrap purchase would silently move
   * the lane out from under the player's traps — the hostile design §4 forbids.
   */
  it("follows the lane when the player pays to move it", () => {
    const shut = buildLevel(SITE.undertown);
    const before: number[] = [];
    tracePath(shut, 77, 24, before);

    const open = buildLevel(SITE.undertown);
    openBuilding(open, OPEN.saloon);
    const after: number[] = [];
    tracePath(open, 77, 24, after);

    assert.notDeepEqual(after, before, "the saloon re-routes the Long Adit; draw it");
  });

  it("re-signs whenever a lane could have moved, and not otherwise", () => {
    const l = buildLevel(SITE.undertown);
    const base = pathSignature(l, 4);
    assert.equal(pathSignature(l, 4), base, "nothing changed, so nothing redraws");
    // A round that opens another gate.
    assert.notEqual(pathSignature(l, 3), base);
    // A building bought.
    openBuilding(l, OPEN.paupers);
    assert.notEqual(pathSignature(l, 4), base);
    // A different site.
    assert.notEqual(pathSignature(buildLevel(SITE.bootHill), 4), base);
  });

  it("shows the Breach only once the Jail has been bought", () => {
    const l = buildLevel(SITE.undertown);
    const before = activeGates(l, 9).length;
    openBuilding(l, OPEN.jail);
    assert.equal(activeGates(l, 9).length, before + 1, "the new lane must be drawable");
    const pts: number[] = [];
    const n = tracePath(l, 34, 44, pts);
    assert.ok(nearRift(l, pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]));
  });
});
