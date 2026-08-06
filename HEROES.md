# THE VIGIL — playable hero design

> Companion to [`GALLOWS_HYMN.md`](GALLOWS_HYMN.md) §7, which owns the hero's
> *verbs* — camera, movement, the Boot, weapons, hexes, archetypes. This document
> owns the hero's *bodies*: who they are, what they look like, and the contract
> that lets there be two of them for barely more than the cost of one.
>
> **Status:** design agreed; both bodies implemented as code-authored grey-box
> (`game/src/render/models/hero.ts`). Selection is a temporary URL parameter
> pending the pre-run screen (§8 below).

---

## 1. Two Vigils

The Bell tunes the dead. A handful of people it cannot tune are left standing in
a county that is now entirely graveyard. §3 gives four reasons the tuning fails —
*a marshal's oath, a preacher's God, a prospector's greed, an undertaker's
professional familiarity with death.* Two of those reasons get a face.

| | **Amos Kell** | **Ada Prewitt** |
| --- | --- | --- |
| **Was** | The last marshal of Hollow Creek | The undertaker of Hollow Creek |
| **Why the Bell can't tune him/her** | An oath he was never released from | She has buried this town once already |
| **The line** | *"Nobody swore me out of it."* | *"I know every one of them by name."* |
| **Silhouette** | Wide brim over a wide yoke — a **T** | Veiled column — an **I** |
| **Personal accent** | `lamp` — a warm band on the hat | `sunbleach` — a pale edge on the veil |
| **Starting archetype** | The Marshal (§7) | The Undertaker (§7) |

Ada's fiction is the strongest one in §3's list and it was going spare. An
undertaker is the one person in Hollow Creek for whom the Orchard opening is not
a horror but a **professional insult** — she filled those graves, she signed for
them, and something has taken the work back. That is the laconic, ledger-voiced
register §3 asks for, and it earns the Undertaker archetype's corpse-and-salt
economy without a word of exposition.

Neither of them is "the girl one" or "the guy one." They are a marshal and an
undertaker, and the roles come from the fiction that was already written.

---

## 2. Why two heroes at all

Three reasons, in order of how much they matter:

1. **Co-op is already a committed constraint.** The decisions table commits to
   "single-player, **co-op-ready architecture** — deterministic sim, command
   queue, serializable pools." A co-op game with one body is two identical
   figures in a dark graveyard, and §1 pillar 2 (legible chaos) dies at the
   moment it matters most. Two silhouettes that separate at 64px is the cheapest
   possible answer, and building it now costs one part-set; building it after the
   netcode costs a rig migration.
2. **The five-second test wants a face.** §1 says the title screen and first
   thirty seconds carry the whole portfolio claim. "Choose your Vigil" with two
   hand-authored silhouettes is a stronger opening beat than a settings menu, and
   it is the cheapest character work in the project — both bodies are code.
3. **It de-risks the §17.6 rig.** Retargeting Mixamo clips onto *two* bodies
   forces the skeleton to be a real contract rather than an accident of one mesh.
   If a clip only works on Amos, that is a bug we want at M0, not at M8.

---

## 3. The silhouette contract

The load-bearing art requirement, and the one thing a review can actually fail
someone on. §17.10's acceptance test is "readable as a black shape at 64px"; for
two heroes the bar is higher — **readable as *which* black shape**.

The two are designed as opposing letterforms:

```
   AMOS — a T                    ADA — an I
   ═══════════                   ═════════
      ▄▄▄▄▄▄▄     wide brim         ▄▄▄       narrow crown
     ▐  ███  ▌                     ▐███▌      veil falls to the shoulder
    ▄▄███████▄▄   broad yoke        ▐███▌     narrow shoulders, no yoke
      ███████                       ▐███▌     bandolier, not a cape
     ▐███████▌                      ▐███▌
    ▟█████████▙   flaring hem       ▐███▌     straight split coat
    ██       ██                     ▐█ █▌
```

The rules that produce it:

- **Amos is widest at the top and at the hem.** A 0.62m brim over a 0.74m yoke,
  and coat tails that splay outward. He is a bell.
- **Ada is the same width from veil to boot.** The veil falls *to* the shoulder
  line rather than sitting above it, so head and body are one continuous mass
  with no neck in it; her coat is a split riding coat that hangs straight, and
  her hat is 0.47m against his 0.62m. She is a column.
- **Neither may borrow the other's headwear.** The brim is Amos's whole read and
  the veil is Ada's. This is the one rule that survives every later art pass.
- **Width comes from different places.** Amos's from a leather storm yoke, Ada's
  from a bandolier and a hip satchel — so even at matched scale the mass sits at
  different heights.

**The veil covers the eyes, not the face.** It is authored in two sections with
an 11cm gap at the jaw, and that gap is load-bearing rather than decorative: the
first two passes ran the cone straight from crown to shoulder, and a face inside
a closed tube is a face no light reaches — under §17.1's hard toon ramp, unlit is
black. Ada rendered as a faceless cowl, which is not a Vigil, it is one of the
Choir (§3). She needs the same `bone` note at the top of her silhouette that
every readable character in this game has.

Verified with the shelf's silhouette mode (`/hymn/?shelf`, press `S`), which is
§17.10 made pressable. Two heroes side by side is exactly the comparison the
shelf exists for.

---

## 4. The shared-rig contract

**One skeleton, one clip set, two part sets.** This is the engineering decision
the whole document hangs on, and it is what makes a second hero cost a day rather
than a milestone.

§17.6 budgets the hero **28 Mixamo clips** — 8-way locomotion, turn-in-place,
fan-fire, the Boot, two deaths, and the rest. That set is authored once against
one skeleton. If the two heroes have different skeletons, that number becomes 56
and the second hero stops being affordable.

So:

| Property | Rule |
| --- | --- |
| **Vertical joint heights** | **Identical.** hips, shoulder, neck, legTop are the same numbers for both. Enforced by test. |
| **Lateral joint offsets** | May differ. Mixamo retargets by bone *name*; a narrower shoulder is a skin change, not a clip change. |
| **Part set** | Both produce the same `HeroParts` shape — same seven parts, same names. |
| **Pivot convention** | Every part authored around its own pivot at the origin, limbs hanging into −Y. |
| **Total height** | 1.8m body (§17.7), headwear allowed past it. |
| **Facing** | −Z, gun hand +X. |

The consequence worth stating plainly: **`actors.ts` and the procedural
locomotion driver in `scene.ts` do not know which hero they are animating.** They
read joints and parts, and a second hero is data. The day the Mixamo rig lands,
it replaces the driver for both at once.

The test suite asserts the vertical-joint rule directly, because it is the one
that silently rots — it is very easy to nudge Ada's shoulder down 3cm to make a
collar sit right, and discover at M8 that every clip pops on her.

---

## 5. Palette

Both heroes are built from the fixed 14 swatches (§17.1). The colour contract is
unchanged and non-negotiable: `hex` means Choir, `bell` means Rift, `oxblood`
means damage dealt, and warm `lamp` means safe/yours.

| Role | Amos | Ada | Why |
| --- | --- | --- | --- |
| Outer | `grave` | `ash` | Ada reads a step darker, which is what lets a pale veil carry her |
| Headwear | `ash` felt | `ash` felt + `sunbleach` veil edge | |
| Sleeve | `ash` | `grave` | Inverted from the outer, so limbs separate on both (§17.1) |
| Mid value | `timber` storm yoke | `timber` bandolier + satchel | Same swatch, different *place* — see §3 |
| Personal accent | `lamp` hat band | `sunbleach` veil edge, bone buttons | The at-a-glance tell in co-op |
| Skin | `bone` | `bone` | |
| Lantern | `lamp` | `lamp` | Both carry one — it is what motivates the player light |

**Both keep the lantern.** It is not a character detail, it is the diegetic
source of the warm point light `scene.ts` carries on the player, and §3's
"grounded first, magic second" means that light needs a cause. It is also the
Vigil's job description.

---

## 6. Mechanical difference: none, deliberately

**In v1 the two heroes are mechanically identical.** Same health, same speed,
same Boot, same everything in §7's movement and combat tables.

This is a decision, not an omission, and the reasoning is the same one that keeps
§6's trap upgrades at exactly two branches:

- **The build already carries the identity.** A run's character comes from its
  archetype (§7), its five trap slots, its relics and its curses (§10). That is
  four systems of divergence deep into a roguelite. A fifth, chosen *before* any
  of them and never revisited, adds no decision — it adds a wiki page telling
  new players which hero is correct.
- **Balancing two heroes across an endless curve doubles the surface** that §4's
  round escalation has to stay honest against, for a difference the player makes
  once per run.
- **Cosmetic choice ages better than mechanical choice.** If Amos is 4% better,
  the choice is solved and Ada is a trap. If they are identical, the choice is
  free and both get played.

The hook for later, if playtesting wants it, is **one signature relic each**
(§10) rather than a stat line — a Rare that only appears in that hero's offer
pool. That keeps divergence inside a system that already exists and already has
rarity, offers and an anti-frustration rule.

---

## 7. Archetype affinity

Each hero *starts* on the archetype their fiction points at, and can take any of
the four once unlocked:

| Hero | Default archetype | Signature weapon | Passive |
| --- | --- | --- | --- |
| Amos Kell | **The Marshal** | Lever Rifle | +25% damage to marked/hexed |
| Ada Prewitt | **The Undertaker** | Absolution (dual, 12 rounds) | Corpses grant 2 salt; Ash Circle −40% |

This is presentation, not mechanics — it decides which archetype card is
pre-selected on the pre-run screen. The Preacher and the Prospector are available
to both and remain unowned by either, which is what stops the roster reading as
"two heroes, two of the four archetypes wasted."

---

## 8. Implementation

**Done.**

- Both bodies authored in `game/src/render/models/hero.ts` against the shared
  `JOINTS` contract, using the code-authoring toolkit in `models/build.ts`.
- `buildHero(id)` in `render/actors.ts` builds either rig; nothing downstream
  changed.
- The shelf (`/hymn/?shelf`) shows both side by side, with silhouette mode.
- Geometry tests cover both: shared vertical joints, limbs hanging below their
  pivots, height against §17.7, triangle budget, and a **silhouette divergence**
  assertion so the two can never quietly converge on the same shape.

- **The muster screen** (`ui/Menu.tsx`) picks hero and map before the run, with
  the chosen map drawn live behind the cards and the chosen hero standing in it.
  `?hero=ada` still works and now seeds the menu's initial selection, so the
  capture harness and any existing bookmark keep working.
- Changing hero swaps the rig **in place** (`Renderer.setHero`). Only the map
  rebuilds the world, because only the map is a simulation choice — which is
  also what makes flicking between the two Vigils instant, and instant is how
  anyone actually compares them.

**Next, in order.**

1. Archetype and seed on the muster screen, next to hero and map (§10 pre-run).
2. Per-hero idle personality — Ada's veil should drift; Amos should thumb his
   hat band. One authored micro-clip each, and it is where the characters start
   reading as people rather than as loadouts.
3. Hero identity into the sim's serializable state, so a replay (§13) and a
   co-op join both know which body to draw. Cosmetic-only today, so it can wait
   — but it must land before co-op, not after.
