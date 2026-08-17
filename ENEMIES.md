# THE TUNED — enemy roster design

> Companion to [`GALLOWS_HYMN.md`](GALLOWS_HYMN.md) §8, which owns the roster's
> *rules* — the invalidation table, the wave director, the AI states. This
> document owns the roster's *bodies*: who is implemented, what each one looks
> like, why it looks that way, and the contracts that keep six (eventually
> fourteen) archetypes legible in one crowd.
>
> **Status:** 6 of §8's 14 archetypes are live — Dustkin, Coyote, Ironjaw,
> Hollow Preacher, Buzzard, Marrow Colossus — as code-authored models in
> `game/src/render/models/enemies.ts` with data rows in `game/src/sim/enemies.ts`.
> The remaining eight are designed in §8 and tracked in §7 below.

---

## 1. The roster, as built

| Enemy | Tier | Unlocks | Invalidates | The player's answer |
| --- | --- | --- | --- | --- |
| **Dustkin** | 1 | round 1 | — (the horde; it teaches) | Anything |
| **Coyote** | 1 | round 2 | Standing still at one choke — it sprints past slow queues | Coverage on both lanes; the Boot |
| **Ironjaw** | 2 | round 3 | Chip damage (hits < 20 clang off) | Big single hits, or amplifiers |
| **Hollow Preacher** | 2 | round 4 | Slow attrition — heals 15 HP/s in 8m, cleanses slows | Your gun. It is a priority *target* |
| **Buzzard** | 2 | round 5 | The ground — flies over everything you built | The revolver; ceiling coverage later |
| **Marrow Colossus** | 4 | round 8 | Everything cheap — armoured mass no single trap answers | The whole kit at once: amplifiers + focus fire |

Two §8 arguments ship in reduced form, honestly labelled: the Coyote's
"least-trapped route" pathing waits on NavSystem (M3), so today it argues with
speed alone; the Colossus's "breaks barricades" waits on blockades becoming
breakable at all (they are unbreakable by decree, §6). Both are in §7's ledger
so they read as debts rather than as cut content.

### The stat rows that are design decisions, not tuning

- **Coyote 24 HP** — Jaws (25) drops one outright. On the Dustkin (45), Jaws'
  verb is deliberately *hold, not kill*; against the pack the same trap becomes
  a clean kill. One placement, two readings, and covering the second lane feels
  like an answer instead of a tax.
- **Preacher 65 HP** — two revolver rounds (2 × 34). "Kill it yourself" must
  cost a deliberate weapon-swap moment, not a magazine; the tax is attention,
  not ammunition.
- **Colossus 520 HP base, not §8's 2500** — 2500 is what one *is* at Act-III
  scale once `hpScaleForRound` and the elite multiplier have compounded, not
  what it spawns with at its round-8 debut. A base of 2500 at round 8 would not
  be an argument, it would be a wall.
- **Colossus armour 20, same as Ironjaw** — it is not a second armour lesson.
  Everything the Ironjaw taught still applies; it just isn't *enough*, which is
  the whole tier-4 point.
- **Preacher and Buzzard have no melee** — one argument per body. A healer that
  also hits you, or a flier that also hurts you, is two arguments in one
  silhouette, and neither gets learned properly.

---

## 2. Every enemy is an argument (the rule this doc serves)

§8's framing is the design constitution: each archetype exists to invalidate
one lazy strategy. That only works if the player can *see which argument is
walking at them* — §1 pillar 2 (legible chaos) at forty bodies on screen. So
the body is not decoration on the stats; the body **is the argument, drawn**:

- The Ironjaw is a wide low block because "your small hits don't matter" is a
  wide low claim.
- The Coyote is a ground-hugging arrow because its argument is where it will be
  in two seconds.
- The Preacher stands perfectly straight in a crowd of hunched things because
  its argument is that the crowd is *organised* now.

An archetype in the sim is one row of data (`EnemyDef`) — no per-type branches
in the systems. That is what makes the next eight affordable.

---

## 3. The silhouette contract

Identification happens by **silhouette and one dominant colour, never by
detail** (§17.10: readable as a black shape at 64px). Every archetype commits
to one shape idea, one dominant swatch, and at most one saturated note:

| Enemy | Shape idea | Dominant | Saturated note | The 64px tell |
| --- | --- | --- | --- | --- |
| Dustkin | **Lopsided hunch** | `dust` rags | `oxblood` chest stain | Uneven shoulders, skull, noose |
| Coyote | **Low dart** | `dust` fur | — (bone muzzle is the accent) | Horizontal at ankle height, ears + flagged tail |
| Ironjaw | **Wide low block** | `grave` plate + `rust` | `lamp` brass fittings | Pauldrons past the hips, no neck |
| Preacher | **Perfect column** | `ash` coat | `hex` eyes + book sigil | Flat hat brim over an unbroken fall of coat |
| Buzzard | **Horizontal cross** | `grave` feathers | `oxblood` ruff | Wings — nothing else in the sky |
| Colossus | **Pale mountain** | `bone` | `oxblood` straps | The only giant, and the only *bright* body |

Rules that keep the table honest:

1. **No two archetypes share a shape idea.** The Coyote and the Buzzard are
   both horizontal — one is on the ground, one is above the walls, and the sim
   guarantees they never occupy the same band of the frame.
2. **Value before hue.** The night palette compresses hue; what survives is
   value. Dustkin = mid `dust` with a bright skull; Ironjaw = dark mass with
   brass points; Colossus = bright mass with dark pits. Squint and the roster
   is still six different figures.
3. **The saturated note is singular and it means something.** Oxblood = the
   dead (§3's faction colour). Brass = the Company. `hex` = the arcane — the
   Preacher's eyes and book share the exact swatch its heal-pulse FX uses, so
   the glow in the crowd and the glow on the body join up into "that one is
   doing it."
4. **Symmetry is information.** The tuned dead are wrong-jointed and lopsided;
   the Preacher's perfect symmetry is what makes it read as *in charge*. Keep
   asymmetry out of it, and keep the Dustkin's asymmetry in.

### The gait contract (movement is identity too)

Until the §14.3 VAT bake lands, locomotion is a procedural pose folded into
each body's instance matrix. The profiles and the pose math live in
`game/src/render/gait.ts` — pure, allocation-free, and tested headlessly
(`tests/gait.test.ts`) so the contrasts can't erode any more than the
silhouettes can. One movement idea per archetype, same as one shape idea:

| Enemy | Gait | The read |
| --- | --- | --- |
| Dustkin | **The shamble** | A visible limp (uneven left/right steps), loose roll, hunched into its own walk |
| Coyote | **The bound** | The roster's highest bounce by far, nose up on push-off and down into the landing, banks hard into turns |
| Ironjaw | **The stomp** | Long strides, stays planted then heaves, leans *back* under the plate, barely banks |
| Preacher | **The procession** | An order of magnitude stiller than the crowd, and perfectly motionless at rest — composure is the movement tell too |
| Buzzard | **Flight regimes** | Beats hard while climbing to cruise, settles to a steady beat, locks into a raised glide; banks into turns, body and wings agreeing |
| Colossus | **The earthquake** | The lowest cadence in the game, sharpest plant, ponderous roll, arm-drag shoulder twist at half the step rate |

Rules the tests pin:

- **Gait phase advances with metres walked, never with the clock.** A
  Tar-slowed body trudges; a clamped one stops mid-step; nothing foot-slides.
- **Statuses override locomotion.** Held: squash + three-frequency shudder, no
  stepping. Launched: rears while rising, tumbles forward while falling.
- **The melee windup is telegraphed on the body** — it rears back through the
  windup and snaps to neutral exactly on the strike frame (§8's telegraph
  rule, §14.6's tell).
- **Cadence orders by mass** (Colossus < Ironjaw < Coyote), and mass does not
  bank into corners.
- The unregistered-archetype fallback moves like the horde filler and the test
  forbids any roster def from actually using it — the same contract
  `ENEMY_MODELS` keeps for shape.

---

## 4. The six bodies

### Dustkin — the horde, and the teacher

Hollow Creek's own dead: hunched, one shoulder high, one arm long, a skull
over an open jaw. The **noose is still on** — a rope collar with the cut end
swinging down the chest. The game is named for the gallows; its commonest enemy
carries the fact. The rope also gives the neck a visible joint, which fixed a
real read problem (the skull used to sit straight on the shoulder slab).

### Coyote — the low dart

The desert's dogs, dead and re-tuned. The only ground-hugging horizontal in
the game: head thrust ahead of the chest, tail flagged behind, the whole body
an arrow pointing where it's going — the honest silhouette for a unit whose
argument is speed. Half the face is bare skull and three ribs show through
each flank; §3's dead don't heal, and this one died in the open. Legs are
splayed mid-stride rather than table-square (a quadruped with matched columns
reads as a bench).

### Ironjaw — armoured mass

Company plate walking. Wide low block, pauldrons past the hips, helmet sunk
with no neck, the jaw guard the name promises. The detail pass added the one
§3 Company colour the first build never spent: **brass** (`lamp`) — jaw bolts,
a brow boss, pauldron studs. Fittings, never plate: it is the difference
between armour with a foundry behind it and a grey lump, and it gives the
moonlight something to find on the widest points of the silhouette.

### Hollow Preacher — the column

A preacher §3's Bell found already ministering and simply *kept*. Perfectly
symmetric and perfectly upright — composure as a tell. Flat void hat brim, an
unbroken fall of ash coat, bone hands clasped on a book with a `hex` sigil
burned into the cover, `hex` eyes floating in the brim's shadow.

Mechanically it is the roster's first support unit, and the hymn has hard
rules (enforced in `sim.test.ts`):

- **15 HP/s within 8m, and cleanses slows** — §8's numbers verbatim.
- **Never heals itself.** The answer is "kill it yourself"; self-healing would
  turn a decision into a DPS check.
- **Keeps singing while clamped in a trap.** Traps must not be the answer to
  the unit whose argument is "your traps stopped working."
- **The tell is mandatory.** A `healPulse` event fires on a shared beat —
  every Preacher in earshot sings in unison — driving hex motes and the sigil
  hum. §8's telegraph rule generalises: an aura with no cue reads as a bug,
  not as difficulty.

### Buzzard — the horizontal cross

Carrion that got back up. Wide flat body, swept wings (separate instanced
pools so they flap — a rigid flier reads as a prop on a stick), hooked bone
beak, oxblood ruff. The detail pass added bone talon hooks curled at the ground
— which is where a buzzard's talons point at everything below it, and this
bird is always above you — and an exposed ridge of spine down the back,
because from the player's usual low angle the back *is* the face.

### Marrow Colossus — the pale mountain

Tier 4 has to read as a different class of problem before the health bar says
so, and it gets there twice: the only giant, and the only bright body. The
whole roster walks in soot and rust; the Colossus is assembled from the
Orchard's own `bone` stock — a ribcage wrapped around a void core, boulder
shoulders wider than the pelvis, knuckle-dragging arms ending in fused bone
mauls, a skull sunk to nothing between the shoulders (the Ironjaw's no-neck
trick, meaning the same thing: nothing here to aim at). On its back, strapped
at a tired angle with the model's only warm colour: **a headstone**. The
graves it was made from, still carried — and it breaks the symmetric silhouette
from behind, the angle the player sees most as it walks away toward the Rift.

---

## 5. Palette discipline

Everything comes from the fourteen §17.1 swatches (`render/palette.ts`). The
roster's additional constraints:

- Enemy identity lives in **vertex colour**; per-instance colour carries
  **state** (hit flash, soak, mark, burn, elite wash). Never both jobs at once.
- `hex` on a body means *arcane agency* — currently the Preacher alone. The
  next caster (Lamplight Wisp) inherits the swatch; nothing non-magical may.
- `lamp` on a body means *the Company's brass* — Ironjaw now, Stagecoach
  Hearse fittings later. It is also the muzzle-flash colour, so it must stay
  in small doses or enemies read as firing.
- `oxblood` is the faction colour of the dead and the only warm note the tuned
  are allowed. One placement per body, maximum.
- The Colossus holds the monopoly on **bone as a dominant**. Bone accents
  (skulls, hands, ribs) are everywhere; a second bone-mass body would bankrupt
  the one read that says "tier 4 is here."

---

## 6. The model authoring contract

What `tests/models.test.ts` enforces on every current and future archetype:

- **Base at y = 0, facing −Z.** `scene.ts` places instances at the sim's feet
  with no per-archetype offset and yaws from velocity.
- **Height within ±25% of `def.height`; reach within 3.2 × `def.radius`.**
  The model follows the tuning, never the reverse — visual scale drift against
  the collision cylinder is the classic §17.7 failure.
- **≤ 1,800 triangles** (§17.7 horde budget; doubly load-bearing because the
  §14.3 VAT bake costs `verts × frames`), and ≥ 40 so nothing ships as a box.
- **Deterministic geometry** — hashes, never `Math.random`.
- **Winding outward** — an inverted face is invisible under backface culling
  and reads as a hole, so the primitive toolkit is tested closed-shell.
- **Fliers author wings as separate hinged pools** (`buildWingGeometry`), so a
  flap is a per-instance transform, not a deformation the instancing can't do.
- Every def key must have an entry in `ENEMY_MODELS` — a missing model renders
  as a *different enemy's* silhouette, which is worse than a missing asset
  because it looks fine.
- **And an entry in `GAITS`** (`render/gait.ts`) — movement identity is held to
  the same standard as shape (§3, the gait contract).

---

## 7. Deferred, and honestly ledgered

| Debt | Blocked on | Where it's tracked |
| --- | --- | --- |
| Coyote paths to the *least-trapped* route | NavSystem (M3) flow-field variants | §8 invalidation table |
| Colossus breaks barricades | Blockades are unbreakable by decree (§6) | This table, revisit with blockade durability |
| Pack spawn choreography (Coyotes arriving as a visible *pack* of 4) | Director trickle work (§8) | §8 wave director |
| Remaining eight archetypes (Rattler, Deadeye, Bone Bride, Wisp, Gravelung, Tumbleweed Hex, Chain Gang, Hearse) | Each needs one new system (burrow, ranged, blink, phase, trap damage, link, spawner) | §8 invalidation table |
| Variants (armoured Dustkin, burning Coyote) | Nothing — palette + stat swaps on existing rigs | §8 "feels like 25 for the cost of 14" |

The rule for promoting one: an archetype ships when its **counter exists on
the map** (§8 constraint 6 — an enemy the site cannot answer is not
difficulty, it is a map with no answer), and its body passes the §3 silhouette
table above *before* the detail pass, not after.
