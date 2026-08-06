# GALLOWS HYMN — Map design

> Five hand-authored **anchor sites**, and the contract they hold with the enemy
> roster, the trap catalog and the procedural generator.
>
> A bare `§N` in this document refers to a section of `GALLOWS_HYMN.md`, which
> remains the source of truth. Sections of *this* document are referred to by
> name. Every number here is either taken from that document or read off the
> shipped M0/M0.7 code (`game/src/sim/level.ts`, `tuning.ts`, `enemies.ts`,
> `traps.ts`, `render/look.ts`).

---

## 1. Why author maps at all

The game is endless rounds on procedurally assembled sites (§4, §11). That is
still true. So the first thing this document has to justify is its own existence.

Five reasons, and only the last one is about content:

1. **§11 step 5 ends with "fall back to a hand-authored guaranteed-valid
   layout."** That fallback is currently unspecified. It needs to exist, it needs
   to be good, and one is not enough — the same fallback appearing every time the
   generator has a bad seed is worse than the bad seed.
2. **Rounds 1–3 are the only rounds every player is guaranteed to see.** Handing
   them to a generator is handing away the tutorial. The first site is authored.
3. **Milestone rounds (10 / 20 / 30) are named bosses** (§4). A boss whose whole
   fight is "marks a 6m circle" (§9, the Hanging Judge) needs a floor plan
   designed around that verb, not a floor plan that happened.
4. **Chunks can only be judged in a lane.** §11 wants ~50 authored 16×16 chunks,
   and the honest way to get chunks that combine well is to author whole maps
   that play well and then *cut them up*. Authoring chunks first and hoping is
   how you get 50 rooms that each work and never assemble.
5. **The generator's guarantees are a floor, not a ceiling.** Random geometry
   can't be trusted, so §11 forbids it from ever omitting a pinch. An author can
   omit the pinch *on purpose* and compensate. Two of the five maps below break a
   generator guarantee deliberately, and those are the two most interesting maps.

**An anchor site is a hand-authored map that ships as a complete site, seeds the
chunk library, and serves as a named fallback.** Five is the right number: one
per kit (§3 lists four) plus one that spans two kits, which is enough to prove
the kit vocabulary recombines before ~50 chunks get built on top of it.

---

## 2. The map invalidation table

The most important artifact in this document, and it is deliberately the same
shape as §8's enemy invalidation table. **Every enemy is an argument; so is every
map.** A map that doesn't invalidate a lazy habit is decoration.

| # | Map | Kit | Size | Gates | **Invalidates** | Answer | Appears |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | **Boot Hill, First Light** | boothill | 48 × 34 | 2 | *nothing — it is the control* | — | rounds 1–3, every run |
| 02 | **Hollow Creek, Undertown** | creek | 80 × 48 × 12 | 3 (+1 you make) | **the finished build** — the map changes shape when you spend | rebuild every round; treat scrap as buying *geometry* | rounds 4–12 |
| 03 | **Shaft Nine, The Deepings** | shaft | 64 × 48 × 3 levels | 3 (+1 from above) | **the flat build** — your traps are on one level, they use three | wall + ceiling coverage, the Boot, and light | rounds 8–18 |
| 04 | **The Crossroads, Hanging Day** | creek / boothill | 56 × 56 | 4 | **the chokepoint** — there isn't one | radial builds, auras, guardians, your own gun | boss round 10; rounds 12+ |
| 05 | **The Reliquary, Choir Practice** | reliquary | 64 × 64 | 3 of 4, rotating | **physical traps, and map memory** | salt, sigils, hexes, and actually reading the ghost paths | rounds 20+ |

Read down the "Invalidates" column and the progression is: *learn the verbs → the
map moves → the map gains an axis → the map loses its shape → the map stops being
a place.* That is the same escalation §8 applies to enemies, applied to geometry,
and the two curves are designed to interleave rather than collide (see **The
director contract**, below).

---

## 3. What every map must satisfy

§11 lists five guarantees the generator may never break. Authored maps are held
to the same list, plus three more that only matter once a human is placing things.

| # | Guarantee | Source | 01 | 02 | 03 | 04 | 05 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | ≥1 pinch | §11 | ✅ ×2 | ✅ (the plaza mouth) | ✅ (the ramp) | ❌ **deliberate** | ✅ (the throats) |
| G2 | ≥4m safe build ring, no gate LOS into it | §11 | ✅ | ⚠️ *until the Jail opens* | ⚠️ *the cage* | ✅ (scaffold uprights) | ✅ |
| G3 | Rift → every gate on foot ≤20s | §11 | 4s | 6s | 8s | 3s | 5s |
| G4 | No enemy path shorter than 18m | §11 | 26m | 46m | 54m | 28m | 40m |
| G5 | ≤180k tris, ≤40 draw calls merged | §11 | ✅ | ✅ | ✅ | ✅ | ✅ |
| G6 | **Rift cell unblocked** before anything else | §21.1 note 3 | ✅ | ✅ | ✅ | ✅ | ✅ |
| G7 | **Surface census satisfies the roster** | this doc | see below | | | | |
| G8 | Every gate telegraphed — lantern + 1.5s cue | §8 | ✅ | ✅ | ✅ | ✅ | ✅ |

**G6 is not paperwork.** M0's first layout put the player's high-ground platform
on top of the Rift; the Rift cell is the flow field's only source, and a blocked
source makes every cell unreachable — zero placeable cells, no pathing, no game
(§21.1 note 3). Every plan below keeps the 4m ring clear of geometry, and the
existing level-guarantee test is the thing that catches it.

### G7 — the surface census, and why it is a contract

§8's invalidation table quietly assumes the answers exist. "Rattler — invalidates
floor traps — counter: wall + ceiling coverage" is only true on a map that *has*
wall and ceiling surfaces. Boot Hill has almost none, by design. So:

> **The other half of this contract is §7.1.** A census is only meaningful if the
> game can actually build on those surfaces, and until decision 16 it could not —
> placement was floor-only, which left 10 of 23 traps unreachable and two of the
> four archetypes unable to use their exclusive trap. §7.1 specifies the oriented
> slot, the targeting change and the projected reach preview; the numbers below
> are what that system reads at run time.

**Floor counts are nav cells (1 m), not placements.** Decision 19 (§7.2) split the
two grids: pathing stays at 1 m, trap placement is 2 m, so one placement box is
2×2 nav cells and is legal only if all four are. Divide the floor column by ~4 for the
number of distinct trap positions a map actually offers — that quarter is the
number to design the puzzle against, and it is the column that matters when
judging whether a site has enough room to build.

| Map | floor (nav) | ≈ placements | wall | ceiling | sigil | **unhallowed** | env slots |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 Boot Hill | ~620 cells | ~155 | 3 faces (the crypts) | **1** (the hanging tree) | 4 | — | 1 |
| 02 Hollow Creek | 1,220 (measured) | ~305 | 25 | 14 — the 12m cavern roof | 9 (5 are chalk) | — | 4 |
| 03 Shaft Nine | ~700 | ~175 | 30 | 22 (timber sets) | 6 | — | 6 |
| 04 The Crossroads | ~1,100 | ~275 | 14 | 5 (the gibbets) | 12 | — | 4 |
| 05 The Reliquary | ~380 | ~95 | 24 | 18 | **41** | ~300 cells | 0 |

Two consequences fall straight out of that table, and both are engineering work,
not flavour:

- **Composition constraint #6** — now landed in §8: the wave director must read the site's
  surface census and ban archetypes the site cannot answer. A Rattler on a map
  with one ceiling anchor is not difficulty, it is a map with no answer. Concretely:
  ban Rattler where `ceiling + wall < 8`; cap Buzzard count at `2 × ceiling`;
  require `sigil ≥ 4` before a Lamplight Wisp may spawn.
- **Constraint #4 must be recomputed when the map changes.** §8 already forbids
  spawning a Deadeye at a gate with line of sight to the Rift. Map 02 lets the
  *player* open new lines of sight mid-site, so that check is no longer a one-time
  bake — it re-runs whenever the geometry does.

### Plan-view legend

All plans are drawn at **1 character = 2 m**, north up, with the exact metres in
each map's build table. `x` runs east, `z` runs south — the same axes as
`sim/level.ts`.

```
  #  rock or wall, 4 m — blocks pathing and sight
  %  building mass, 8 m — solid; no interior until opened
  B  boarded door — pay scrap to open (map 02 only)
  =  deck — boardwalk 0.30 m, platform 1.35 m, or catwalk +5.0 m
  ^  steps or haulage ramp
  o  post, pillar or timber set, 4 m
  :  crate or low cover, 1.2 m — blocks pathing, breaks sight
  ,  headstone, trough, wagon, 0.9 m — blocks nothing, breaks sight
  .  open ground
  u  unhallowed ground — arcane placements only (map 05)
  R  the Rift            P  player start          G  gate
  c  ceiling anchor — chandelier, hoist, crossbeam, bell, gibbet
  r  rail line — mine cart run        x  ore chute — a one-way drop
  V  the cage — a descending hoist    b  latent breach (map 02)
  *  chalk mark — traceable sigil slot
  $  scrap cache
  s  salt ring crossing (map 04)      D  the Debt, chained (map 02)
```

---

## 4. Map 01 — Boot Hill, First Light

**48 × 34 m · boothill kit · 2 gates · rounds 1–3 of every run**

The Orchard on the hill above Hollow Creek, an hour before dawn. Iron fencing, a
hanging tree, three family crypts in a row, and forty years of headstones. This
is the shipped M0 site (`sim/level.ts`, "Boot Hill, first light") re-cut onto the
16m chunk grid and extended with the second gate, the crypt row and the tree.

**What it invalidates: nothing.** It is the only map in the game with no
argument, and that is the argument. Every other map is measured against how this
one plays. If Boot Hill is teaching, it is doing its job.

```
        x=0        16        32        48
        |          |          |         |
  z=0   ##############G#########
  z=2   #..............#.......#
  z=4   #.......,......#.......#
  z=6   #...===^.%%....#.......#
  z=8   #...===^.%%....#.......#
  z=10  #...===^...c...#o......#
  z=12  #........,.....#o......#
  z=14  #........%%............#
  z=16  #...R.P..%%............G
  z=18  #........%%....#.......#
  z=20  #........o.....#.o.....#
  z=22  #..............#.......#
  z=24  #........%%....#.......#
  z=26  #........%%....#.......#
  z=28  #..............#####...#
  z=30  #......................#
  z=32  ########################
```

### The four things it teaches, in order

1. **Round 1 — a lane and a pinch.** One gate (east, `z=16`), one 4m gap in the
   orchard fence at `x=30`. Starting purse 160 buys Tar (40) + Vent (55) + Jaws
   (30) with change (§5), and the pinch is exactly wide enough that one Tar Seep
   does *not* seal it — §21.2 note 2, kept on purpose. Coverage is the player's
   problem from the first minute.
2. **Round 2 — the loop is real.** The fence stops at `z=26` and a flank wall
   runs `x=30→38` at `z=28`, so there is a second, longer route around the south.
   The flow field prefers the pinch; bodies that get shoved take the loop. This is
   why M0 built a loop at all, and it stays.
3. **Round 3 — the second gate.** G2 opens in the north wall at `x=28`, *inside*
   the fence. A player who spent everything at the pinch now watches a lane they
   never covered. The lesson is not "your build is void" — the two lanes converge
   at the middle crypt, 11m from the Rift, so a defence in depth already covers
   both. **A chokepoint is a place, not a strategy**, and that sentence is the
   entire setup for Map 02.
4. **The hanging tree** is the map's one environmental slot and its one ceiling
   anchor: free once, 120 damage in 4m, 15 salt to reset. It exists so that
   "environmental traps are a thing" is learned somewhere safe.

### The crypt row

Three stone masses at `x = 18–22`, at `z = 6–10`, `14–18` and `24–28`, each 3.5m
tall, with 4m gaps between them. It is the most load-bearing geometry on the map
and it does four jobs at once:

- Breaks G1's line of sight straight down `z=16` to the Rift (**G2** satisfied).
- Breaks G2's diagonal from `(28,0)` to the Rift (satisfied by the north crypt,
  which is why it sits at `x=19,z=7` and not somewhere prettier).
- Turns one pinch into two by forcing the crowd through the gaps.
- Provides the map's only wall-trap faces — three of them, which is deliberately
  not enough. Boot Hill is floor-only, and the Buzzard unlocks at round 4, one
  round *after* the player leaves. That timing is the joke, and it lands on
  Map 02.

### Build table

Exact arguments for the existing kit in `sim/level.ts`. `WIDTH = 48`,
`DEPTH = 34` (the shipped M0 depth, unchanged), `CELL = 1`.

| Call | Arguments | Note |
| --- | --- | --- |
| `wallRun` | `0,0, 48,0` · `0,34, 48,34` · `0,0, 0,34` · `48,0, 48,34` | perimeter |
| `wallRun` | `30,0, 30,14` | fence, north of the pinch |
| `wallRun` | `30,18, 30,26` | fence, south of the pinch — 4m gap at `z 14–18` |
| `wallRun` | `30,28, 38,28` | flank wall; the loop passes east of `x=38` |
| `block` | `19,8, 4,4, 3.5` | north crypt |
| `block` | `19,16, 4,6, 3.5` | middle crypt — breaks G1's line |
| `block` | `19,25, 4,4, 3.5` | south crypt |
| `block` | `10,9, 6,5, 1.35` + `steps 15.7,9, 3,0.45,0.9,5,-1` | player's plinth — **north of the 4m Rift ring**, per §21.1 note 3 |
| `pillar` | `18,21` · `31.5,11` · `31.5,23` | flank the lane, never block it |
| `block` | headstones, 0.9m, ~24 scattered west of the fence | cosmetic; break sight, block nothing (`bakeBlocked` ignores `y1 < 1.0`) |
| — | `gates: [{x:46,z:16, fromWave:1}, {x:28,z:0, fromWave:3}]` | needs the new `fromWave` field |
| — | `rift: {x:8, z:16, radius:2.2}` · `playerStart: {x:12, z:16, yaw:-π/2}` | |
| — | `envSlots: [{kind:'gibbet', x:22, z:10, damage:120, radius:4, resetSalt:15}]` | the hanging tree |

### Light and palette

Open sky, one directional moon, fog 30–110 as shipped in `render/look.ts` — at
48m across, the fog never bites, and that is the point: Boot Hill is the only map
where you can see the whole site at once. `bone` headstones, `grave` crypts,
`dust` ground, one `lamp` lantern burning at each gate, `hex` cyan only at the
Rift. Four swatches and one accent; anything richer is Map 02's job.

### What could go wrong

- **Round 3 is the whole design risk.** If opening G2 reads as unfair rather than
  instructive, the fix is the convergence distance, not the gate — pull the middle
  crypt from `z=16` toward `z=18` and the two lanes merge sooner. Do not remove
  the gate; the lesson is load-bearing for the next three maps.
- The plinth is 1.35m and the crypts are 3.5m. Under `isPlaceable`'s current rule
  ("no floor traps on the player's high ground"), the plinth is correctly
  unplaceable — but the same rule will reject Map 02's 0.30m boardwalks, which
  must be placeable. See **Engine work**.

---

## 5. Map 02 — Hollow Creek, Undertown

**80 × 48 × 12 m · creek kit · fully subterranean · 3 gates and a fourth you
make yourself · rounds 4–12**

The flagship. §2 already names *Buried* as the game's art direction — "gaslit
frontier town, wooden boardwalks, a mine beneath everything, a church at one end
and a saloon at the other, warm candle-orange against cold blue-black" — and this
is the map that cashes that cheque. It is also the map the launcher screenshots.

### The town is underground, and that is the premise

The Amaranth Company undercut the west end of Hollow Creek for forty years. On the
night Shaft Nine opened, the ground let go: the chapel, the assay office, the
saloon and two rows of boardwalk dropped **thirty metres** into the void the
Company had made, and landed almost intact — still standing, still lit. The rock
closed over the top except for one breach. The lamps never went out.

**Nothing on this map is on the surface.** The perimeter is not a fence, it is
living rock. There is no sky, no moon and no horizon. This matters far past
atmosphere, because five separate design problems the map previously papered over
are solved by the ceiling actually being there:

| Problem | On the surface | Underground |
| --- | --- | --- |
| "Ceiling traps work over open street" | An assertion the player has to accept | There is rock overhead. You can see the anchor you are bolting to |
| The Buzzard cruises at 4.6m | Unbounded sky; the flier is a pure gun problem | A 12m lid. It is inside ceiling-trap range, and it *reads* as being inside a room |
| Every light is a lamp | Contrived — why is there no moon? | There is no moon because there is thirty metres of strata above you |
| Fog at 18–70m | Arbitrary draw distance | Cave air. The far end of the street genuinely disappears |
| The map has no free high ground | You had to buy the saloon balcony | **The Fall** — the rubble cone under the breach, below |

It also buys a piece of world continuity for free: the Undertown sits directly
above Shaft Nine (Map 03), and the Long Adit at the east end is the same drift
you fight down two maps later.

### What we take from Buried, and what we reject

Same discipline as §2. **Structure and mood, never assets or names.** Nothing here
is copied; each row is a mechanic we would want anyway, wearing that map's clothes.

| Taken | Why it earns its place here |
| --- | --- |
| **A town under a rock roof** | §2 wants the image. The *mechanical* consequence is the real prize: a 12m cavern ceiling over an outdoor street means **ceiling traps work outside**, on the one map where that matters, and it gives the Buzzard a lid to fly under |
| **A map you open with currency** | §2 lists this as taken already. It maps exactly onto a trap game: you are not buying access, you are **buying geometry** |
| **Chalk on the walls** | Straight into the existing sigil system (§6, traps 19–23). Faded marks you pay *salt* to trace, so they compete with hexes, not with traps |
| **A dense crate maze** | Becomes the Paupers' Rows: the densest trap real estate on the map, and the slowest lane |
| **A giant you release who breaks walls** | Becomes **the Debt**: a chained Marrow Colossus. Reworked so that releasing it has a permanent geometric cost, which the original did not |
| **Church at one end, saloon at the other** | Verbatim from §2. The chapel holds a bell; the saloon holds a chandelier and a balcony |
| **Rejected: the wall-buy economy** | Trap loadouts come from roguelite offers (§2). Buying guns off a wall would flatten that |
| **Rejected: the perk layer** | Relics already occupy that slot (§10) and do it with legible rarity tiers |
| **Rejected: everything else** | No named characters, no easter-egg quest chain, no ghost. The world is laconic and does not wink (§3) |

### What it invalidates: the finished build

Every other map is a fixed puzzle. This one changes shape **because you paid to
change it**, so the kill box that cleared round 6 is aimed at a wall that has a
door in it by round 8. It is the only map where scrap buys geometry, and the only
map where the correct answer to "I have 150 spare" might be "make the site worse."

```
        x=0        16        32        48        64      78
        |          |         |         |         |        |
  z=0   ########################################
  z=2   #......................................#
  z=4   #.......,...........,............,.....#
  z=6   #%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#
  z=8   #%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#
  z=10  #%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#
  z=12  #%%%%c%%%%%%%%$%%%%%%%%%%%D%%%%%%%%c%%%#
  z=14  #%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#
  z=16  #%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#
  z=18  #%%*%B%%%%%%%%B%*%%%%%%%%%B%%%%%%%%B%%%#
  z=20  #======================================#
  z=22  #...o.........o.........o.........o....#
  z=24  G......................................G
  z=26  #......,.................,.............#
  z=28  #============..........================#
  z=30  #%%%%%%B%%%%%%%%....%%%%%%%B%%%%.......#
  z=32  #%%%%%%%%%%%%%%%....%%%%%%%%%%%%.^^^^^.#
  z=34  #%%%%%%%%%%%%%%%....%%%%%%%%%%%%.^^^^^.#
  z=36  #%%%%%%%%%%%%...o...o..%%%%%%%%%.^^G^^.#
  z=38  #%%%%%%%%%%%%..........%%%%%%%%%.^^^^^.#
  z=40  #%%%%%%%%%%%%.....R....%%%%%%%%%.^^^^^.#
  z=42  #%%%%%%%%%%%%........P.%%%%%%%%%.......#
  z=44  #%%%%%%%%%%%%~~~o~~~o~~%%%%%%%%%.......#
  z=46  #################b######################
```

North row, west to east: **Chapel of the Ninth Hour**, **the Assay Office**, the
plaza mouth, **the Jail**, **the Fetch & Carry**. South row: **the Paupers'
Rows**, the plaza, **the Long Account** (saloon), and **the Fall**. Main Street
runs east–west at `z 20–28` with 0.30m boardwalks along both sides. The Rift is
the **town well** at `(36, 36)`, eight metres deep into the plaza, under the
**gallows frame** — the pit-head headframe that came down with it, whose four legs
are the geometry that breaks every sightline into the well.

The `~` along the south is the creek itself, still running, now a **sump**. It is
cosmetic and blocks nothing; it exists because a town that fell thirty metres
should have water at the bottom of it, and because a Tar Seep laid along its lip
reads exactly right.

### The Fall

The breach, at the south-east, and the map's one vertical feature: a hole in the
roof thirty metres up where the ground came through, and a **rubble cone** of
strata and street beneath it, rising to about 4 m.

It does four jobs, which is why it replaced the north adit the first draft had:

1. **It is the only light in the map that is not a lamp.** A single cold shaft
   (`bell`, the moonlight value from `render/look.ts`) falling through thirty
   metres of broken rock, hitting the cone. Everything else in the frame is
   `lamp` orange. The §2 image — warm candle-orange against cold blue-black —
   arrives as *one contrast* rather than as a colour scheme.
2. **It is free high ground.** The cone is the map's only vantage you don't have
   to buy, and it looks straight across the plaza at the well from 34 m.
3. **It is a vertical gate.** G3's bodies come *down* the cone rather than out of
   a tunnel, and it is where every Buzzard enters. A flier that arrives through
   the ceiling on the map with a ceiling is the whole argument in one spawn.
4. **It is why the cavern is not sealed**, which the fiction needs and the
   ventilation needs — the lamps have been burning down here for a while.

### The roof, which is a mechanic

Rock at **12 m** over the town, opening to 30 m at the Fall. Three consequences,
all of them the reason the visual reference was worth taking literally:

- **Ceiling traps place anywhere.** Chandelier Drop, Rain of Nails, Buzzard Roost
  and Church Bell (§6, traps 15–18) work over open street, on the timber sets the
  Company left bracing the roof. No other map allows that, and it is the census
  line that makes this the answer-rich map. Under §7.1's slot contract these are
  ordinary `ceiling` slots with `normal: −Y`; the map does not need a special case,
  it just has an unusual number of them.
- **The Buzzard has a lid.** It cruises at 4.6 m under a 12 m roof, so for the
  first time the flier is inside trap range rather than purely a gun problem.
  §21.3 note 3 — `if (e.grounded[i] === 0) continue;` — stays exactly as written;
  what changes is that ceiling traps never read `grounded`.
- **The renderer stops drawing a world.** No sky dome, no starfield, no moon disc,
  no hills beyond the perimeter — all four are surface-only scenery and all four
  are wrong here. Fog tightens to 14–55. That is engine work item 9, and the
  Undertown is what forces it.

### The Boarding — six buildings, and what each one costs you

Each building is boarded. Pay scrap in the build phase and it opens
**permanently**. Opening one gives interior surfaces, a player shortcut and
usually an env slot — and re-bakes the flow field, because the boards were
load-bearing walls.

**The build phase draws the new ghost paths before you commit.** §4 is explicit
that hidden wave composition is hostile design, and hidden *geometry* consequences
would be worse. Nothing here is a gotcha; it is a decision you have to read.

| # | Building | Scrap | You get | You pay |
| --- | --- | --- | --- | --- |
| 1 | **The Fetch & Carry** | 75 | A freight hoist (ceiling, 120 dmg in 4m, 15 salt to reset) and 14 wall faces | Nothing, on its own — see *the alley rule* below. This is the genuinely safe purchase, and 75 is what safe costs |
| 2 | **The Long Account** (saloon) | 100 | A balcony deck at +3.5m overlooking both the street and the plaza — the best position on the map — plus a chandelier and 20 wall faces | Its back door opens a **second plaza mouth**. The east crowd no longer has to use the first one |
| 3 | **Chapel of the Ninth Hour** | 150 | **The bell** — the Church Bell effect (stagger + fear 3s in 7m, §6 trap 16) for 15 salt, 8s cooldown, free forever after | Opens the west road into the north alley. Costs the most and opens the least; the bell is why |
| 4 | **The Assay Office** | 100 | A one-time **+200 scrap cache** and a sigil floor | Nothing, on its own. Its back window is broken, which is the *second* door onto the alley — see below |
| 5 | **The Jail** | 150 | **The Debt** — see below | Everything |
| 6 | **The Paupers' Rows** | 75 | The densest floor real estate on the map: stacked coffins, 2m aisles, 30-odd trap cells inside 18 × 12m | A slow grinding sub-lane off the west road, and no ceiling under the crate stacks |

**Cost curve note.** 75 / 100 / 150 sits deliberately between a trap (30–130) and
an upgrade (1.5× base). Opening a building should feel like buying two traps you
cannot place yet.

#### What the geometry actually does — measured, not asserted

This section replaces an earlier one, and the reason is worth recording.

The first draft claimed an **alley rule**: the north service alley would be a
harmless dead-end pocket with one building open, and a bypass lane with two. It
was the best idea in the map. It is also false, and a probe over the built level
said so in one line — every gate measured **exactly** the same distance to the
Rift with all 64 combinations of buildings open as with none:

```
boarded                  (3,24) 39.1m   (77,24) 47.1m   (71,37) 45.0m
all three alley doors    (3,24) 39.1m   (77,24) 47.1m   (71,37) 45.0m
```

Two reasons, and both are properties of the engine rather than of the map:

1. **The alley is always longer.** Getting from the chapel door to the assay door
   through the alley is 12 m north, 18 m along and 12 m back south — 42 m against
   18 m of street. A shortest-path flow field will never choose it, so no number
   of doors makes it a lane.
2. **A 20 m plaza mouth sitting on the direct route cannot be beaten.** Every
   alternative entrance was the same length or longer, so opening the saloon
   changed nothing either.

The fix was geometry, not tuning: two **throat wings** neck the plaza mouth from
20 m down to **8 m, six metres deep**, and the Rows and the saloon each get a door
in their *plaza* flank rather than only on the street they already front. Measured
again:

| Open | West drift | Long Adit | The Fall |
| --- | --- | --- | --- |
| boarded | 44.9 m | 53.5 m | 51.3 m |
| **the Paupers' Rows** | **42.0 m** | 53.5 | 51.3 |
| **the saloon** | 44.9 | **50.0 m** | **47.8 m** |
| chapel · assay · fetch | 44.9 | 53.5 | 51.3 |

**The correction that matters is conceptual.** With one shortest-path field there
is no such thing as *splitting* the crowd — a cheaper route does not add a lane,
it **moves** the lane. Your kill box is not overwhelmed, it is bypassed. That is
harsher than the original claim and it is a cleaner statement of what this map is
for, so the map got better by being wrong first.

What survives, honestly labelled:

- **The Rows and the saloon change where the crowd walks.** Those two are the
  Boarding.
- **The Jail creates the Breach**, ten metres out.
- **Chapel, Assay and Fetch & Carry do not move the crowd at all.** They are
  player infrastructure: the bell, the cache, the hoist, thirty wall faces, and a
  private route along the back of the map so you are not crossing your own killing
  floor mid-wave. Their cost is opportunity cost — 75–150 scrap is two traps — and
  the build panel should say exactly that rather than implying a spatial price
  that does not exist.

A crowd that never splits also means the §8 Coyote Pack ("paths to the *least
trapped* route") is not a stat variation but a **second flow field weighted by trap
density**. That is now the one piece of pathing work this map is waiting on, and it
is what would make an alley worth having.

### The Debt

The Jail holds a chained Marrow Colossus (§8, tier 4, 2,500 HP). Pay 150 and:

- It walks out, **breaks the plaza's south cavern wall**, and opens **G4** at
  `(34, 46)` — ten metres behind the Rift.
- It fights **for you** for 45 seconds, walking the length of Main Street to get
  there, which is the spectacle the map is built around.
- Then it turns.

G4 is 10m from the Rift. **§11 guarantee 4 says no enemy path may be shorter than
18m, and this breaks it.** That is the design: *the only gate in the game with a
short path and a clear line to the Rift is one the player chose to make.* The
generator may never do this. An author may, once, for 150 scrap, with the ghost
path drawn in advance.

The Jail's interior is the compensation — cell bars, a stove and a gun rack give
the map's best concentration of wall faces, 20m from the well.

### The chalk

Five faded marks: chapel west face, Assay street face, saloon back wall, inside
the Paupers' Rows, and one on a water-tower leg. **20 salt** traces one, and it
becomes a permanent Sigil of Nine (§6 trap 19, +50% damage taken in 5m) at that
spot for the rest of the site.

Salt, not scrap, on purpose. Salt regenerates at 1 per 4s and caps at 100 (§5),
so tracing a mark is four hexes you will not cast. It is the only place in the
game where the map sells you a trap and the currency is your spellbook.

### Gates and lanes

| Gate | At | Live | Path to the Rift | Line of sight |
| --- | --- | --- | --- | --- |
| G1 **The Haulage Drift** | `(3, 24)` | round 1 | **44.9m** — street east, then south through the throat | Blocked by the Paupers' Rows |
| G2 **The Long Adit** | `(77, 24)` | round 1 | **53.5m** — street west, then the throat | Blocked by the saloon |
| G3 **The Fall** | `(71, 37)` | round 3 | **51.3m** — north off the cone, west, then the throat | Blocked by the saloon mass |
| G4 **The Breach** | `(34, 44)` | never, unless you open the Jail | **10m** | **Clear** — deliberate |

Distances are the baked flow-field cost from the gate cell, not straight lines —
they are what `level.dist` actually reports, and the tests assert them.

G1 and G2 are not roads any more; they are the drifts the Company drove to reach
the seam, which is also why Main Street is straight and 8 m wide. The north alley
keeps no gate at all — it is dead service space behind the buildings, and that is
precisely what makes opening the Chapel or the Assay worth considering: they are
the only two ways for *you* to get into it.

**The throat is the pinch:** 8m wide and 6m deep, between the two wings, and it is
the *only* way in until you start spending. Opening the saloon puts a door in its
plaza flank; opening the Paupers' Rows puts one in theirs; opening the Jail puts a
hole in the back wall. **Every building you open moves the lane off the pinch you
built on.** That single sentence is the map.

### What could go wrong

- **The Boarding could read as a tax rather than a choice.** The tell will be
  players never opening anything. If that happens the fix is not cheaper
  buildings — it is making the *first* one free at wave 2, so the mechanic gets
  taught the way §8 teaches an invalidator: alone, early, with spare budget.
- **Four gates and six openable buildings is a lot of flow-field re-bakes.** M0's
  bake is one relaxation-sweep Dijkstra over ~1.5k cells; this map is ~1,900. It
  runs on a build-phase button press, never mid-wave, so a millisecond is fine —
  but measure it rather than assume, and re-run §8 constraint #4 after every
  re-bake, because the Deadeye check is no longer a one-time result.
- **The alley rule is invisible until it fires.** A player who opens the Assay,
  sees no change, and then opens the Fetch & Carry two rounds later will
  experience the lane as arriving from nowhere unless the UI connects them. The
  fix is in the build panel, not the geometry: a boarded building's tooltip must
  name the doors already open and say *"this makes the alley a lane."*
- **A sealed cavern is a lighting problem before it is an art problem.** With no
  directional light, `applySceneLighting`'s moon contributes nothing and the whole
  map falls to the hemisphere term plus point lights. Budget: gaslamps are 8
  dynamic point lights at High (§14.2) and the street is 80 m long, so they cannot
  simply be placed every 12 m as the palette note wants. Either bake the lamp
  pools into the floor's vertex colours — which `buildFloorGeometry` is already
  shaped to do — or accept 4 real lights and fake the rest.
- **Two of the six buildings now cost nothing on their own.** That is correct
  under the alley rule but it does mean a first-time player's first purchase is
  always free of consequence, which risks teaching them that opening is safe right
  before it stops being. Acceptable: that is the same shape as §8's "first
  appearance is alone, in a wave with spare budget."

---

## 6. Map 03 — Shaft Nine, The Deepings

**64 × 48 m across three levels · shaft kit · 3 gates and one from above · rounds 8–18**

The mine, below the town, where the Amaranth Company hit something that was not
ore. Timber sets, a rail line the length of the main gallery, three ore chutes
over an open stope, and one hoist cage. The Rift is the shaft head itself — the
hole they opened — at the bottom of the cut.

**What it invalidates: the flat build.** Every map so far has been a plan view.
This one has a Y axis, and the crowd uses all of it: the gallery at 0m, the stope
floor at −6m, catwalks at +5m, and from wave 4 a cage that ignores all three.

### Gallery plan (0.0 m)

```
        x=0        16        32        48        62
        |          |         |         |         |
  z=0   ################################
  z=2   ################################
  z=4   ################################
  z=6   #..............................#
  z=8   G..............................#
  z=10  #..............................#
  z=12  #..............................#
  z=14  ######.#################.#######
  z=16  #..............................#
  z=18  #..............................#
  z=20  #.......o.......o.......o......#
  z=22  #..............................#
  z=24  #rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrG
  z=26  #..............................#
  z=28  #.......o.......o.......o......#
  z=30  ###^^^^^##x###x##x##############
  z=32  ###^^^^^..........##############
  z=34  ###^^^^^.V........##############
  z=36  ###^^^^^..........##############
  z=38  ###^^^^^.....R..P.##############
  z=40  ###...............##############
  z=42  ###............................G
  z=44  ###...............##############
  z=46  ################################
```

Rows `z=32` through `z=44` are the **stope floor at −6.0 m**, not the gallery. The
`^` column at `x 6–14` is the haulage ramp connecting the two; the `x` marks at
`z=30` are ore chutes, which are one-way drops.

### Section, looking west

```
   +5.0 m   catwalk        ==================        ladder at x=10 and x=54
                                  |
    0.0 m   drift  ####  rib  ####==== gallery ====####   rail line along z=24
                                  |            \
                          ore chutes  x  x  x   \  ramp: −6 m over 14 m of run
                                  |              \
   -6.0 m   stope          #######================#####   the Rift at (26, 38)
```

### The four things that make it a different game

1. **Two ways down, and only one of them is theirs.** The haulage ramp is the
   pinch — every body from G1 and G2 walks it. The three ore chutes are one-way
   drops the flow field will not path down, so they are **player tech only**:
   Boot a body off the gallery lip and it falls 6m onto the stope floor, taking
   fall damage (`LAUNCH.fallDamagePerMetreSecond` 3.4) and landing wherever you
   built. **Chute + Boot is the map's signature verb**, and it is worth ×2.0 if a
   trap finishes them inside the 3s boot credit (§7).
2. **The catwalks are yours.** Boot Hill gave you a 1.35m plinth. Here you own a
   +5m walkway the length of the gallery, with the rail line directly beneath it.
   The map trades away the safety of a single lane and hands you the high ground
   as compensation.
3. **Darkness is a mechanic, not a mood.** Fog 8–30, no directional light at all,
   and the only illumination is lantern pools at the timber sets plus whatever you
   bring. Enemies are silhouettes until they are lit. **This is the map where the
   Hex Lantern stops being an amplifier and becomes vision** — §6 trap 12 already
   promises "reveals in darkness," and this is the site that cashes it.
4. **The mine carts.** Two, on the rail line at `z=24`, running the full 60m of
   the gallery: 200 damage to everything on the track plus a launch (§6, guardian
   G3, the site-slot unit). Free once each, then 15 salt. It is the zombies-lineage
   "environmental one-shot you pay to activate" (§2) and it already exists in the
   catalog, so the map is claiming it rather than inventing it.

### Gates

| Gate | At | Level | Live | Path | Note |
| --- | --- | --- | --- | --- | --- |
| G1 **The East Adit** | `(62, 24)` | gallery | wave 1 | 54m — the full rail lane west, then the ramp | The long lane the carts are built for |
| G2 **The North Drift** | `(0, 8)` | gallery | wave 1 | 58m — east along the drift, south through the west winze, then the ramp | Arrives at the ramp head immediately; a completely different problem to G1 |
| G3 **The Lower Drift** | `(62, 42)` | **stope** | wave 3 | 36m — straight across the stope floor | Bypasses the ramp entirely. The wave the ramp build stops being enough |
| G4 **The Cage** | `(18, 34)` | descends to stope | wave 4+ | **12.6m** | Deliberate guarantee break, below |

**The cage** is the second deliberate break of §11 guarantee 4, and unlike the Jail
it is not optional. Mitigation is built in and must ship with it:

- It descends for **3 full seconds in plain view**, with the winch audio starting
  1.5s before that (§8 telegraphing — never spawn behind the player without a cue).
- Its **landing pad is a placeable surface**. The counterplay is explicit: pre-trap
  the pad. A player who has seen the cage once and does nothing about it has made
  a decision, which is the standard §4 holds every wave to.

### Surfaces and the roster

22 ceiling cells (the timber sets) and 30 wall faces make this the first map where
the Rattler is legal under the new census constraint, and it debuts around round
10 alongside the Gravelung — which is also when losing a trap hurts most, because
placement here is scarce and vertical. That collision is intentional: the map, the
burrower and the trap-destroyer arrive together and ask one question between them.

### What could go wrong

- **Three levels is three times the pathing surface.** The flow field is 2D. Either
  bake one field per level with explicit link cells at the ramp and the winzes, or
  accept that the chutes are non-navigable and only the ramp joins the graph. The
  second is cheaper, correct for this map, and is what the plan above assumes.
- **`groundHeight()` currently ignores `y0`** (`sim/level.ts`) — it returns a box's
  top surface even when the player is standing *underneath* it. Catwalks and the
  saloon balcony both need that fixed before either map is walkable. See
  **Engine work**.
- **Darkness plus 40 bodies could simply be unreadable.** The hedge is that
  silhouette and emissive are the readability language anyway (§2, Risk of Rain 2),
  and every enemy already carries a rim value. If it fails, the fix is lantern
  density, not fog distance — moving fog changes the whole feel of the kit.

---

## 7. Map 04 — The Crossroads, Hanging Day

**56 × 56 m · creek / boothill hybrid · 4 gates · boss round 10, then rounds 12+**

Where the four roads out of Hollow Creek meet, and where the county did its
hanging. A scaffold at the centre, a well house, a wagon yard, a windmill and a
grave plot at the corners, and nothing else between you and the horizon.

**What it invalidates: the chokepoint.** There isn't one, and there is no way to
make one. Four roads, 360 degrees of approach, and the Rift in the middle of all
of it.

```
        x=0        16        32        48   54
        |          |         |         |    |
  z=0   ##############G#############
  z=2   #..........................#
  z=4   #...%%%%%%........::::::...#
  z=6   #...%%%%%%........::::::...#
  z=8   #...%%%%%%....c...::::::...#
  z=10  #...%%%%%%........::::::...#
  z=12  #..........................#
  z=14  #..........................#
  z=16  #.............s............#
  z=18  #..........................#
  z=20  #..........................#
  z=22  #..........................#
  z=24  #..........................#
  z=26  #............o.o...........#
  z=28  G...c...s.....R.....s...c..G
  z=30  #............o.o...........#
  z=32  #..........................#
  z=34  #.............P............#
  z=36  #..........................#
  z=38  #..........................#
  z=40  #.............s............#
  z=42  #..........................#
  z=44  #..........................#
  z=46  #...%%%%%%........,,,,,,...#
  z=48  #...%%%%%%....c...,,,,,,...#
  z=50  #...%%%%%%........,,,,,,...#
  z=52  #...%%%%%%........,,,,,,...#
  z=54  ##############G#############
```

The `o` at `(26,26) (30,26) (26,30) (30,30)` are the scaffold's four uprights; the
crossbeam spans them at +5m and is the map's central ceiling anchor. The Rift is
the ground under the trapdoor, at grade — **not** on a raised deck, because a deck
would need stairs and stairs would be a chokepoint.

### Breaking guarantee 1 on purpose

§11 forbids the generator from ever producing a site without a pinch, and it is
right to. A random map with no pinch is a random map with no answer. **An authored
one can be, provided it pays for it**, and this map pays three ways:

1. **It is small.** 56 × 56, so the Rift is at most 28m from any point of the
   perimeter and the player can genuinely be everywhere. Traverse to the furthest
   gate is 3 seconds at sprint.
2. **It is the env-slot-richest map in the game.** Four road-mouth gibbets, 20m out
   along each road, each a Coffin Hatch as environment: instant kill on one
   non-boss body, free once, 15 salt to reset. Every road has an answer built into
   it before you spend a coin.
3. **The salt ring is already drawn.** A permanent 12m-radius arc of salt around
   the scaffold, free, from wave 1 — 80 damage/s to Choir units and no phasing
   through it (§6, trap 4). A radial map with no Wisp answer would be miserable,
   and handing the player the answer costs nothing because the ring is scenery
   that happens to be a rule.

What the player has to bring instead of a chokepoint: **auras, guardians and their
own gun.** Sigil of Nine, Lime Pit, Barbed Coil and the Bell Ringer are all
radius-shaped rather than lane-shaped, and this is the map where that stops being
a stylistic preference. The Crossroads is where a build that never left the pinch
finds out what it actually is.

### Line of sight, and why the Rift is under the scaffold

Four roads pointing at the centre is four gates with a clean shot at the Rift —
which violates guarantee **G2** and, worse, makes §8 constraint #4 unsatisfiable
(no legal Deadeye gate anywhere on the map). The scaffold is the fix: four 0.6m
uprights and a 1.1m plank skirt around the trapdoor break the eye line from road
level in all four directions, while leaving the ground itself completely open to
walk across. It is the only piece of geometry on the map that has to be exactly
where it is.

### The boss arena

This is the intended round-10 arena for **The Hanging Judge** (§9). The fit is not
a coincidence — the fight was designed around a floor plan like this one:

- **Verdict** marks a 6m circle you must leave. On an open floor, leaving it is a
  real decision about *which way*, and every direction has your traps or his.
- **Contempt** summons a Chain Gang you must clear while fighting. A map with no
  chokepoint means the horde arrives everywhere, so the Chain Gang is a genuine
  second front rather than a queue.
- **Sentence** hangs one of your Guardians at 50%. This is the map where you most
  want Guardians — see above — so the punishment finally has something to punish.

### The dust storm

The one map with a standing weather modifier, using the `WaveModifier` slot the
§8 `WaveSpec` already carries. Visibility drops to 20m (fog 6–22) on alternating
waves. On a 360-degree map you cannot watch the whole perimeter anyway, so the
storm converts sight into **sound**: gate cues, the gibbet ropes, and the Judge's
chain are how you know where the pressure is. It is also the cheapest possible
atmosphere — two fog numbers and a particle emitter.

### What could go wrong

- **A no-pinch map may just be a bad map.** This is the highest-risk design in the
  document and it should be prototyped before the art. The kill criterion is
  concrete: if a competent player's round-12 clear rate here is more than one
  round worse than on Map 02, add a pair of low stone walls on the diagonal
  approaches and accept that it is a *four*-pinch map instead of a no-pinch one.
- **Four simultaneous gates from wave 1 may overload the Bill.** §4 requires the
  full manifest be readable in the build phase. Four columns of icons is the most
  the HUD can carry; do not add a fifth gate here, ever.
- The gibbets are Coffin Hatches, which are instant kills. Four free instant kills
  per wave is a real economy leak — they should award **no** scrap and no Tally, so
  they buy time rather than money.

---

## 8. Map 05 — The Reliquary, Choir Practice

**64 × 64 m · reliquary kit · 3 of 4 gates, rotating every wave · rounds 20+**

Beneath the mine, where the Choir keeps its instruments. Four chapel cells around
a nave, and the Rift is the Ninth Bell itself. §3 gives this kit one job: *"the
kit is where the game stops being a western."*

**What it invalidates: physical traps, and map memory.** Two arguments, because
round 20 is where one is no longer enough.

```
        x=0        16        32        48       62
        |          |         |         |         |
  z=0   ################################
  z=2   ##G.........#uuuuuu#.........G##
  z=4   ##..........#uuuuuu#..........##
  z=6   ##...o......#uuuuuu#......o...##
  z=8   ##..........#uuuuuu#..........##
  z=10  ##..........#uuuuuu#..........##
  z=12  ##......o...#uuuuuu#...o......##
  z=14  ##..........#uuuuuu#..........##
  z=16  ##..........#uuuuuu#..........##
  z=18  ##..........#uuuuuu#..........##
  z=20  ##..........#uuuuuu#..........##
  z=22  ##..........#uuuuuu#..........##
  z=24  ######.#####uuuuuuuu#####.######
  z=26  ##uuuuuuuuuuuuuuuuuuuuuuuuuuuu##
  z=28  ##uuuuuuuuuuuo....ouuuuuuuuuuu##
  z=30  ##uuuuuuuuuuuuuRuuuuuuuuuuuuuu##
  z=32  ##uuuuuuuuuuuuuuuPuuuuuuuuuuuu##
  z=34  ##uuuuuuuuuuuo....ouuuuuuuuuuu##
  z=36  ##uuuuuuuuuuuuuuuuuuuuuuuuuuuu##
  z=38  ######.#####uuuuuuuu#####.######
  z=40  ##..........#uuuuuu#..........##
  z=42  ##..........#uuuuuu#..........##
  z=44  ##......o...#uuuuuu#...o......##
  z=46  ##..........#uuuuuu#..........##
  z=48  ##..........#uuuuuu#..........##
  z=50  ##...o......#uuuuuu#......o...##
  z=52  ##..........#uuuuuu#..........##
  z=54  ##..........#uuuuuu#..........##
  z=56  ##..........#uuuuuu#..........##
  z=58  ##G.........#uuuuuu#.........G##
  z=60  ################################
  z=62  ################################
```

*A row labelled `z=N` is the 2 m band from `z=N` to `z=N+2`; 32 rows is 64 m.*

The plan is four-fold symmetric and that is visible in the ASCII, which is the
point. It is the same room four times.

### Unhallowed ground

The `u` cells — the whole nave and all four arms, about 300 of them — are marked
in the Choir's chalk. **Only arcane placements are legal there.** Sigils and Salt
Line place; Jaws, Tar, Vent, Plate and every other iron/tar/fire/powder trap
refuse, with the ghost turning cyan and the hotbar saying why.

That is a hard, legible, one-sentence rule that does the work §3's colour contract
promises: *cyan means physical traps don't work here.* Every other map states that
contract in paint. This one states it in the placement validator, and it is the
first time the player's whole hotbar is wrong.

The cells — the four corner rooms — are ordinary ground. So the map is not "you
may not build"; it is **"you may only build where they aren't going yet."**

### The gates move

Three of the four cells are live each wave, and **which three changes every wave.**
The Choir opens a different door. Consequences:

- The flow field re-bakes between waves. It is one Dijkstra sweep over ~4,100
  cells, in the build phase, so cost is not the issue.
- **The ghost path preview stops being a nicety and becomes the interface.** §4
  already shows ghost paths from every active gate in the build phase; on every
  other map you learn the lanes once and stop looking. Here the preview is the
  only way to know where the wave is coming from, and a player who has stopped
  reading it will find out.
- It is the strongest available statement that the western is over. Boot Hill was
  a place. This is a permutation.

### The wrong geometry, done cheaply

§3 asks for space that feels wrong; §17.0 says there is no budget and no Blender
experience. Four techniques, all of which are free:

| Technique | How | Cost |
| --- | --- | --- |
| **Repetition as unease** | One authored cell, instanced four times with mirrored transforms | One cell's worth of work for a whole site |
| **You never see the room** | Fog 4–18. The nave is 20m across; you can see a third of it | Two numbers in `look.ts` |
| **Pillars that don't reach the floor** | `Box` already carries `y0` and `y1`; the kit's helpers just never use `y0 > 0`. Set `y0 = 1.4` and the pillar hangs | One new helper — and it needs the `groundHeight()` fix Map 03 also needs |
| **A ceiling of bells** | Instanced static props at 6m, no light, no sound until the wave starts | `BatchedMesh`, one draw call (§14.3) |

Palette: `ash`, `grave` and `void` for everything structural, `hex #4ff0e0` for
every mark and every crack. Cyan is the only colour in the map that is not grey,
so the contract does the entire art direction on its own.

### No environmental slots

Deliberately zero — the only map with none. Boot Hill gives you a tree, the Creek
gives you four fixtures, Shaft Nine gives you six, the Crossroads gives you four
before you spend anything. Here the environment is not on your side. That absence
is the last escalation the map has left, and it should be felt rather than
explained.

### Gates

| Gate | At | Path to the Bell | Note |
| --- | --- | --- | --- |
| G1–G4 | `(4,4)` `(58,4)` `(4,58)` `(58,58)` | 40m each, identical by construction | Exactly three live per wave, rotating; LOS blocked by the cell walls at `x/z = 24` and `38` |

Symmetry means every gate is the same distance and the same shape. There is no
"main lane" to fortify — the only asymmetry on the map is the one you build.

### What could go wrong

- **Rotating gates could feel arbitrary rather than tense.** The fix is
  telegraphing, and it must be generous: the cell that will open next wave should
  start humming during the *tally* screen of the current one, so the player builds
  toward it rather than being surprised by it. Difficulty from composition, never
  from secrecy (§4).
- **A hotbar that mostly refuses to place is a frustrating hotbar.** The mitigation
  is offer weighting: §10's offer system should heavily favour sigils and hexes for
  the two rounds *before* the Reliquary can appear, so the player arrives with
  something legal. If that does not land, shrink the unhallowed zone to the nave
  only and leave the arms buildable.
- Four-fold symmetry plus 4–18m fog is a real disorientation risk for players who
  navigate by landmark. Give each cell one unique silhouette element at the
  doorway — a different broken instrument — visible at fog distance.

---

## 9. Engine work these maps require

Nine items, read off the shipped code. Six are small; two are behavioural changes
to functions the existing tests cover, so they need care.

| # | Change | Where | Needed by | Note |
| --- | --- | --- | --- | --- |
| 1 | `buildLevel(siteId)` and a `SiteDef` | `sim/level.ts` | all | `WIDTH`/`DEPTH`/`CELL`/`buildBoxes()` are module constants today. Everything else here depends on this landing first |
| 2 | **`BOX.deck`** kind + a `deck()` helper emitting `y0 > 0` boxes | `sim/level.ts`, `render/mesher.ts` | 02, 03, 05 | `Box` already carries `y0`; only the helpers assume `0`. `mesher.ts` needs a fifth `baseColor` case |
| 3 | **`groundHeight()` must respect `y0`** | `sim/level.ts:357` | 02, 03, 05 | It currently returns any box's `y1` when `(x,z)` is inside its footprint, so a player *under* a catwalk snaps to the top of it. Must take the highest surface at or below the query height |
| 4 | **Split `isPlaceable()`'s low-box rule by `BoxKind`** | `sim/level.ts:345` | 01, 02 | Today any box with `y1 < 1.0` blocks placement — the "floor traps are for the floor" rule from M0. A 1.35m plinth should keep blocking; a 0.30m boardwalk must not. Key off `kind`, not height |
| 5 | Surface classes — floor / wall / ceiling / sigil / **unhallowed** | `sim/level.ts` + `TrapDef` | 02, 03, 05 | §6 already requires placement validated against surface tags; `isPlaceable` returns one boolean. Unhallowed = `elem === ELEM.arcane` only |
| 6 | `Level.gates[].fromWave` | `sim/level.ts` | 01, 02, 03 | §4 requires later waves to activate more gates; M0 has one gate and no gating |
| 7 | `Level.envSlots: EnvSlot[]` — kind, position, one-shot flag, salt reset cost | `sim/level.ts`, new system | all but 05 | §4 guarantees at least one per site and none exist yet |
| 8 | **`rebake(level)`** — re-run `bakeBlocked` → `bakeDistance` → `bakeFlow` after geometry changes | `sim/level.ts` | 02, 05 | The three passes are already separate functions; this is mostly plumbing plus re-running §8 constraint #4 |
| 9 | Per-site fog and lighting | `render/look.ts` | 03, 04, 05 | `Fog(ash, 30, 110)` is hard-coded. Move the two numbers, the moonlight intensity and the hemisphere strength into the `SiteDef` |
| 10 | **Ghost paths** — `sim/paths.ts` traces the field, `render/paths.ts` draws it | new | all, but 02 needs it | §4's build-phase preview. A ribbon per active gate, draped on the floor and flowing toward the Rift, gone on round start. Two rules: it must walk `flowDir` (the same function the enemies steer by — a preview drawn by different code than the thing it previews is a lie waiting to happen), and it must re-trace whenever a lane could have moved. Map 02 is why it is not optional: buying the saloon silently re-routes two gates, and §4 forbids exactly that kind of hidden consequence |

**Boardwalks are 0.30 m, not 0.35 m.** `PLAYER.stepOffset` is 0.35, and specifying
the deck at exactly the step height puts the whole map on the wrong side of a
floating-point comparison. 0.30 leaves margin and needs no step-up handling at all.

**Item 3 is the one to be careful with.** `groundHeight` is called from the player
controller, the launch/landing code and the trap placement ghost; changing its
contract touches all three. Write the test first — "a player standing at
`(x, z)` under a deck whose `y0 = 5.0` reports ground 0.0" — then change it.

---

## 10. How these five feed the generator

§11 wants ~50 authored 16×16 chunks on a 4m placement grid. These maps are where
they come from, and the order matters: **author the map, play it, then cut it.**

| Map | Chunk grid | Yield | Tags contributed (§11 `ChunkTag`) |
| --- | --- | --- | --- |
| 01 Boot Hill | 3 × 2 | 6 | `pinch` ×2, `sniper_perch`, `trap_rich` |
| 02 Hollow Creek | 5 × 3 | 15 | `pinch`, `atrium`, `vertical`, `trap_rich` ×3, `dark` |
| 03 Shaft Nine | 4 × 3 × 3 levels | 14 | `vertical` ×4, `rail` ×3, `dark` ×5, `pinch` |
| 04 The Crossroads | 3.5 × 3.5 | 9 | `atrium` ×4, `trap_rich` |
| 05 The Reliquary | 4 × 4 | 8 (one cell, instanced) | `dark` ×4, `pinch` ×4 |
| | | **52** | |

Fifty-two, which is the number §11 asked for, and every one of them has been
played inside a lane before it enters the library. The Reliquary's eight is really
two authored chunks plus symmetry, which is the §17.5 attachment-set trick applied
to level geometry.

Three rules for the cut:

1. **A chunk's connectors are decided by where the cut falls, not the other way
   round.** Cut along the 16m lines the map was already drawn on; do not redraw the
   map to make tidy connectors.
2. **Anything that spans a cut becomes an env slot or gets moved.** The mine cart
   rail runs 60m across four chunks; it becomes a `rail`-tagged connector type, not
   a chunk feature.
3. **The five maps stay in the library as complete sites**, not only as parts.
   They are the §11 step-5 fallback, and a fallback assembled from its own chunks
   is not a fallback.

---

## 11. Tests

Extending `game/tests/sim.test.ts`, which already covers the §11 level guarantees
for the single M0 site. Everything here is headless and deterministic.

| Test | Asserts | Why |
| --- | --- | --- |
| `every site: rift cell unblocked` | `blocked[riftCell] === 0` before any other check | §21.1 note 3 — this is the failure that silently kills the whole game |
| `every site: every gate reaches the rift` | `isFinite(dist[gateCell])` for all gates, at every `fromWave` | G-list guarantee 1 |
| `every site: no path under 18m` | `dist[gateCell] >= 18` — **with a declared exemption list** | The Debt and the cage are the only two legal exemptions; the test names them, so a third one cannot appear by accident |
| `every site: safe build ring` | ≥4m around the Rift is placeable and has no clear ray from any gate footprint | G2. Must re-run after `rebake()` |
| `every site: traverse ≤20s` | Rift → each gate ≤ `20 × PLAYER.sprintSpeed` along the flow graph | G3 |
| `every site: surface census satisfies the roster` | For each enemy legal at that site's round band, its §8 counter exists in the census | **The new one.** This is the test that stops a Rattler shipping onto a ceiling-less map |
| `map 02: every building opening leaves every gate connected` | All 64 open/closed combinations re-bake to a valid field | 6 buildings = 64 states. Cheap, exhaustive, and it will find something |
| `map 05: every gate rotation is valid` | All 4 three-of-four sets pass the full guarantee list | 4 states |
| `map 02/05: rebake is deterministic` | Same open-set → identical `dist` array and identical state hash | §13 — a re-bake inside a run must not break replay |

The 64-state test on Map 02 is the one worth writing first. Combinatorial geometry
changes are exactly the class of bug that is invisible in play and lethal in a
leaderboard run.

---

## 12. Build order

Maps are cheap to author and expensive to validate, so the order is by what each
one unblocks rather than by map number.

| When | Do | Why then |
| --- | --- | --- |
| **M1** | Engine items 1, 4, 6 · finish **Map 01** as the real M0 site | Item 1 unblocks everything else; Map 01 is a re-cut of shipped geometry, so it is nearly free |
| **M2** | Engine items 5, 7 · env slots and surface classes · the census test | Both are content-framework work M2 is already doing |
| **M3** | Engine items 2, 3, 8 · **Map 03** and **Map 04** · the chunk cut | M3 is procgen + nav; the vertical map and the no-pinch map are the two that stress the navmesh bake hardest, and the chunk library has to exist by the end of it |
| **M4** | **Map 02**, look-dev quality | §21 M4 exits on "one Creek room at final visual quality." The Undertown *is* the Creek room — and a sealed cavern is the easiest possible look-dev target, because every light in it is one you placed. The Boarding is the mechanic worth having on screen when the Path A / Path B call gets made (§23.2 item 1) |
| **M6** | **Map 05** · item 9 · the Boarding economy pass | Reliquary is act-3 content and the first thing §21 says to cut if time gets tight |

**If time gets tight, cut in this order:** Map 05 → the dust storm → the Debt →
Map 04's boss framing (keep the map). Do **not** cut the Boarding, the ghost-path
preview on Maps 02 and 05, or the surface census test. The first is the reason Map
02 exists, the second is what keeps both maps honest, and the third is a
correctness check, not content.

---

## 13. Open questions

1. **Does a no-pinch map work at all?** Map 04 is the one genuinely unproven design
   here. It is grey-box-testable at M3 for about a day's work, and it should be
   tested before anything is drawn.
2. **Is the Boarding scrap or a third currency?** Scrap is the assumption above and
   it keeps the tension sharp (a building is two traps). But it does mean a player
   who opens two buildings is a player who built nothing that round, which may be
   too steep at the low end of the round curve.
3. **How many anchor sites does a run see?** §4 says "a new site every few rounds."
   Five maps at three rounds each covers round 15; past that the run is on procgen
   or on repeats. Repeats are probably fine — the build is different every time —
   but the alternative is authoring anchors 6 and 7 from the same chunk library,
   which is cheap once the library exists.
4. **Should the Debt be a relic instead of a map feature?** As written it exists on
   exactly one map. As a relic ("*The Account Falls Due* — once per site, release
   what the site has chained") it would generalise, at the cost of the Jail being
   the specific memorable thing it currently is.
5. **Does Map 03's darkness need a fallback for accessibility?** §20 covers
   colourblind and reduced motion but not low vision, and a map whose central
   mechanic is "you cannot see" needs a stated position before it ships.
