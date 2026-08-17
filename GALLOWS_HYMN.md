# GALLOWS HYMN — Game Design & Technical Plan

> A hidden, browser-native **trap-defense third-person shooter roguelite** in a
> western-gothic world where the dead don't stay buried and iron, salt and
> blasphemy are the only tools that work. Orcs Must Die's build-fight-combo loop,
> run-based structure, hand-authored art, and a performance bar high enough that
> the game itself is the portfolio piece.

**Title:** ***GALLOWS HYMN***. Two words, one from each half of the genre — the
*gallows* is unmistakably frontier justice, the *hymn* is unmistakably gothic and
ties straight to the antagonist (the Choir, the Ninth Bell, the note the dead
hum). Hard consonants, easy to say, impossible to confuse with anything else.
Route: `/gallows-hymn`.

**The graveyard is still called the Bone Orchard.** Keeping the folksy slang as
the *place* and the gothic register as the *title* is strictly better than
either alone — the sign on the fence reads `BONE ORCHARD · NO TRESPASSING`, and
the title card that fades in over it reads `GALLOWS HYMN`.

**Runners-up, in order:** *Mourning Bell* (the dawn/dead pun is lovely — you
hold the line until dawn — but softer), *Black Vespers* (most gothic, least
legible), *Sepulchre County* (great friction between the two words, a mouthful),
*Pale Verse* (too close to *Pale Rider*).

**Status:** planning only. No code committed yet. This document is the source of
truth, same role `BUDGETTER.md` plays for `/budgetter`.

**Decisions already locked (from scoping):**

| Axis | Decision |
| --- | --- |
| Mode | **Endless rounds. The highest round reached is the score.** Clear a round → get paid → spend it on traps → ring the bell (§4) |
| Scope | **Roguelite structure inside an endless frame** — procedurally assembled maps from hand-authored chunks, randomized offers, permadeath, meta unlocks. The act/boss structure folds in as **milestone rounds** (every 5th) |
| Runtime | **Separate Vite sub-app**, vanilla three.js + ECS core on a fixed timestep; React only for menus/HUD |
| Renderer | **WebGL2 only** for v1, behind a thin backend seam so a WebGPU/custom path can be added later without touching gameplay (§14.7) |
| Budget | **$0.** Every tool in the plan is free; the zero-cost stack and its honest quality gaps are in §17.0 |
| Art | **AI-assisted + CC0, no rigging, minimal Blender** (§17.0). Rigging and animation route through **Mixamo**; environments start as **code-generated geometry** (Path A), with a hand-built Blender kit as an optional later upgrade. Art happens *after* the grey-box game is fun |
| Audio | **Generated in-house, hand-mastered** — free-tier and local models plus CC0 sources, through a real post pipeline (§16.4, §17.0) |
| Co-op | **Single-player, co-op-ready architecture** — deterministic sim, command queue, serializable pools |
| Visibility | **Unlinked, not locked** — no password. `noindex`, `robots.txt` disallow, absent from nav/sitemap/command palette. Anyone with the link can play (§18.2) |
| Leaderboard | **Global, all players**, name + local key, no accounts (§18.3) |

---

## Table of contents

1. [Vision & pillars](#1-vision--pillars)
2. [What we take from the references (and what we reject)](#2-what-we-take-from-the-references-and-what-we-reject)
3. [The world — western gothic bible](#3-the-world--western-gothic-bible)
4. [Core loop & run structure](#4-core-loop--run-structure)
5. [Economy, scoring & the poker-hand combo system](#5-economy-scoring--the-poker-hand-combo-system)
6. [The trap catalog](#6-the-trap-catalog)
7. [The hero: weapons, hexes, archetypes](#7-the-hero-weapons-hexes-archetypes)
8. [Enemy roster & the wave director](#8-enemy-roster--the-wave-director)
9. [Bosses](#9-bosses)
10. [Roguelite meta: offers, relics, camps, ante](#10-roguelite-meta-offers-relics-camps-ante)
11. [Procedural site assembly](#11-procedural-site-assembly)
12. [Technical architecture](#12-technical-architecture)
13. [Determinism & the co-op-ready contract](#13-determinism--the-co-op-ready-contract)
14. [Rendering plan & performance budgets](#14-rendering-plan--performance-budgets)
15. [Navigation, collision & physics](#15-navigation-collision--physics)
16. [Audio](#16-audio)
17. [Art direction & the AI-assisted pipeline](#17-art-direction--the-ai-assisted-pipeline)
18. [Hosting, the launcher & the API](#18-hosting-the-launcher--the-api)
19. [Testing, tooling & debug](#19-testing-tooling--debug)
20. [Accessibility & settings](#20-accessibility--settings)
21. [Milestones](#21-milestones)
22. [Risk register](#22-risk-register)
23. [Decisions log & remaining questions](#23-decisions-log--remaining-questions)
24. [Appendix A — dependency ledger with verified versions](#appendix-a--dependency-ledger-with-verified-versions)
25. [Appendix B — repo layout](#appendix-b--repo-layout)

---

## 1. Vision & pillars

**The one-sentence job:** *"I want to feel like a gunslinging engineer — read the
ground, wire it into a killing machine, then go stand in it and shoot."*

The whole game is one sentence of tension: **the traps do the killing, but you
have to be in the room for it to be good.** A player who only builds gets a
mediocre score. A player who only shoots dies on wave four. The scoring system
exists to force the marriage.

### Five pillars

1. **The ground is the weapon.** Every site is a puzzle about geometry —
   chokepoints, drop heights, rail lines, sightlines. The best moment in the game
   is realizing a room can be turned into a conveyor belt of death. Level layout
   is therefore *content*, not backdrop, and procgen must protect that.
2. **Legible chaos.** Forty enemies on screen must remain readable: silhouette
   language, one dominant colour per faction, hex-cyan for anything that hurts
   *you*, oxblood for anything that hurts *them*. If the player can't tell what
   killed them, the game is broken regardless of framerate.
3. **Style is the score.** Killing efficiently is table stakes; killing
   *beautifully* is the point. The combo system (§5) is the game's actual
   difficulty curve — survival gets easy, mastery never does.
4. **Every enemy is an argument.** Each archetype exists to invalidate one lazy
   strategy (§8). The player's build must keep answering new questions, which is
   what stops a roguelite from collapsing into one dominant loadout.
5. **Sixty frames is a design constraint, not an optimization pass.** Budgets in
   §14 are fixed up front; content that can't fit them doesn't ship. The
   portfolio claim is "I can build a real-time 3D game in a browser at 60fps" —
   a 40fps game makes the opposite claim.

### The five-second test

The portfolio's own `CLAUDE.md` rule: *if a visitor can feel the craft within
five seconds, the page is doing its job.* For a game, five seconds means the
**title screen and first thirty seconds** carry everything: a slow dolly over a
lamplit graveyard with dust in the god rays, a revolver that kicks and cracks,
one bear trap that snaps a shambler in half with a hit-stop freeze and a smear
of red. Build that sequence early (M0) and re-polish it last (M10). It is the
trailer, the case study hero shot, and the thing that decides whether anyone
plays past the menu.

---

## 2. What we take from the references (and what we reject)

### Orcs Must Die 1 & 2 — the loop anatomy

What actually makes it work, in order of importance:

| Mechanic | Why it matters | Our version |
| --- | --- | --- |
| Enemies walk a **committed path** to an objective | Makes trap placement a prediction problem with a knowable answer. The moment enemies become unpredictable, trap-building becomes gambling and the genre dies | Flow-field pathing to **The Rift**; every enemy's route is legible and previewable in the build phase (§11, §15) |
| **Unlimited build time between waves, building allowed during** | Removes punishment for experimentation while keeping in-combat agency | Same. Build phase is untimed; mid-wave building costs a 25% scrap surcharge so it's a real decision |
| **Leaks cost a shared health pool**, not instant loss | Gives partial failure a texture; you can bleed and recover | Vigil points: start 20, +5 per wave cleared, capped 30 |
| Player is a **combatant, not a cursor** | The reason it isn't just a tower defense. Kicking an enemy into your own trap is the signature verb | The **Boot** (§7) — a cooldown launch that is the single most important combo enabler in the game |
| **Trap loadout is limited** and chosen before the map | Forces identity and makes each run a build, not a buffet | 5 trap slots + 2 hex slots, filled by roguelite offers rather than a pre-run menu |
| **Score/skulls** as the real progression | Survival is the floor; the score is the game | Tally → Ash (§5, §10) |
| Traps are **cheap, spammable, and combo-multiplicative** | Volume is fun; a trap that costs half your budget is a decision, not a toy | Cost curve tuned so wave-1 income buys 3–4 traps |

**Rejected from OMD:** the mission-select campaign and 5-skull rank grind (we're
roguelite instead); and the "guardian" units as a primary strategy (they
trivialize lanes — ours are expensive and fragile).

**Taken from OMD, and this is a hard commitment: the stylized, cartoony look.**
Not its *humour* — the world stays laconic and grim per §3, and nothing winks at
the setting. But the rendering language is chunky, exaggerated, bold-coloured and
readable, not photoreal. Three independent reasons, any one of which would be
enough:

1. **Legible chaos (pillar #2) demands it.** Forty bodies on screen read by
   silhouette and flat colour. Photoreal material detail is noise at that density;
   OMD stays readable at exactly the counts we're targeting because its forms are
   simple and its colours separate.
2. **It's the honest answer to the $0 / no-Blender constraints (§17.0).** Stylized
   reads as *intentional*; attempted-realistic reads as *failed*. This converts our
   biggest weakness into a deliberate choice.
3. **It's what makes Path A viable.** Code-generated geometry (§17.0) looks like
   programmer art under a realistic shader and looks *correct* under a cartoony
   one — chunky primitives with bold flat colour is the target look, not a
   compromise toward it. This single decision retires most of R23.

### Black Ops zombies — tone, not structure

- **Buried (the reference).** Gaslit frontier town, wooden boardwalks, a mine
  beneath everything, a church at one end and a saloon at the other, warm
  candle-orange against cold blue-black. Legible, grounded, *dusty*. Space feels
  like a real town that something happened to. **This is our art direction.**
- **Shadows of Evil (the anti-reference).** Art-deco noir, tentacles, purple
  neon, ostentatious Lovecraft. Gorgeous, but the visual language is loud and
  crowded — bad for reading forty enemies, and it drags the western into
  pastiche. **Take exactly one thing from it:** the idea of a *single* recurring
  otherworldly motif (their tentacle = our **Ninth Bell / choir-sigil**) that
  intrudes on an otherwise mundane world.
- Also taken from the zombies lineage: **rounds with a rising musical intensity**,
  **environmental one-shot traps you pay to activate** (mine cart, chandelier),
  and **a map that unfolds** as you spend currency to open it. That last one maps
  beautifully onto roguelite site expansion.

### Genre-adjacent structure references

- **Hades** — the "escalating offers between rooms" cadence and a boon system
  with legible rarity tiers. Our offers copy its readability (name, tier,
  one-line rules text, no hidden math).
- **Slay the Spire** — the ascension ladder as post-completion content, and the
  discipline of *seeded, replayable* runs.
- **Deep Rock Galactic / Risk of Rain 2** — how to keep a 3D horde readable at
  scale with silhouette + emissive language.

---

## 3. The world — western gothic bible

### Premise

In 1887, the Amaranth Mining Company hit something at the bottom of Shaft Nine
that was not ore. The town of **Hollow Creek** buried its dead in the Bone
Orchard on the hill for forty years; on the night the shaft opened, the Orchard
gave them all back. What came out of the ground was not simply the dead — it was
the dead **conducted**, moving in time, humming a note none of them had a throat
for.

The thing at the bottom of Shaft Nine is called **The Ninth Bell**. It does not
raise the dead so much as *tune* them.

You are the **Vigil** — one of the few the Bell cannot tune, for reasons each
archetype interprets differently (a marshal's oath, a preacher's God, a
prospector's greed, an undertaker's professional familiarity with death). You
cannot close the Rift. You can only stand at each one it opens and hold the line
until dawn, night after night, worse each time.

### Tone rules

- **Grounded first, magic second.** The world is wood, iron, dust, lamp oil,
  black powder, canvas. Magic is a *contaminant*: chalk sigils, salt lines, cyan
  light bleeding from cracks that shouldn't glow. If a thing can be explained by
  1880s engineering, explain it that way — the one bear trap that is *just a bear
  trap* makes the sigil next to it terrifying.
- **Dry, laconic voice.** Frontier understatement. The Vigil says as little as
  possible. UI copy uses ledger language: *the bill*, *the tally*, *paid in
  full*, *the account*, *settled*.
- **Religion is present and unhelpful.** Churches are useful for their bells and
  their salt, not their comfort.
- **No winking.** No modern slang, no jokes at the setting's expense. The comedy,
  when it comes, is in the physics of a coach gun launching a corpse into a
  chandelier.

### Faction language (drives silhouette + palette)

| Faction | Fiction | Silhouette | Colour |
| --- | --- | --- | --- |
| **The Tuned** | Hollow Creek's own dead, moving in rhythm | Human, wrong-jointed, sagging clothes | Bone white, grave grey, dried oxblood |
| **The Company** | Amaranth's miners and enforcers, still on shift | Bulky, industrial, helmets, iron plate | Rust, soot black, brass |
| **The Choir** | Whatever the Bell actually is, wearing bodies as instruments | Elongated, floating, too-still, unnaturally symmetrical | Hex-cyan emissive, ash grey |
| **The Vigil (you)** | The living, barely | Long coat, hat, defined shoulder line | Warm lamp-orange, deep indigo |

**Colour contract:** cyan emissive *always* means Choir/arcane and *always*
means "physical traps don't work here." Orange/lamp always means safe/yours.
Oxblood always means damage dealt. This is a hard rule, enforced in review — it
is the single biggest readability lever we have.

### Site archetypes (the four kits)

1. **Boot Hill** — the Orchard itself. Headstones, iron fencing, a hanging tree,
   open sightlines, wind. *Design role:* long lanes, few walls, rewards ranged
   traps and the player's own gun.
2. **Hollow Creek** — boardwalks, saloon, gunsmith, chapel, water tower.
   *Design role:* tight interiors, doorway chokepoints, drop-downs from
   balconies, breakable railings. The best kit for combos.
3. **Shaft Nine** — the mine. Timber supports, rail lines, cart tracks, ore
   chutes, lantern pools in total darkness. *Design role:* verticality, one-shot
   environmental kills, and the darkness as a real mechanic.
4. **The Reliquary** — Choir-infested space beneath the mine; the geometry is
   wrong, chalk sigils everywhere, no natural light. *Design role:* act 3 only.
   Anti-trap enemies dominate; the kit is where the game stops being a western.

---

## 4. Core loop & run structure

### The loop, and the score

**There is no win condition. The score is the highest round you reached.**

```
ROUND LOOP  (≈60–120 s)  read the bill → spend the purse on traps → ring the bell
                         → fight → round clears → GET PAID → repeat, harder
RUN         (open-ended) round 1 … round N, until the Vigil is spent. N is your score.
```

That single change — from "beat three acts" to "how far can you get" — does a lot
of work:

- **The difficulty curve becomes the content.** Every round is the same verbs
  against a harder question, so the game needs a great *curve* rather than 12
  hand-built maps. For a solo project that is the difference between shipping and
  not (§17.0).
- **Every session ends in a number**, which is what makes a leaderboard mean
  something (§18.3) and what makes "one more run" work.
- **The economy gets a natural beat.** Money arrives at the end of a round, in a
  lump, while you are safe and thinking — which is exactly when you want to be
  making build decisions.

**The act/boss structure isn't discarded, it's folded in.** Every **5th round is an
elite round**: far fewer bodies, 3.4× the HP, 4× the payout. It's a change of
question rather than more of the same, and it gives the run a rhythm and a set of
memorable milestones ("I died on 17") without needing an act break. Named bosses
(§9) become milestone rounds at 10 / 20 / 30.

Target: a competent player reaches round 8–12 on their first few runs, round 20+
once they understand the synergies, and 30+ only with a genuinely good build.

### Wave anatomy

```
  ┌── BUILD (untimed) ──────────────────────────────────────┐
  │ The Bill posted: exact enemy manifest for the wave       │
  │ Ghost paths shown from each active gate to the Rift      │
  │ Place / sell / upgrade traps. Sell refunds 100% in build │
  └──────────────────────┬──────────────────────────────────┘
                         │ player rings the bell to start (no timer pressure)
  ┌── COMBAT ────────────▼──────────────────────────────────┐
  │ Spawns arrive in 3–5 telegraphed trickles, not a blob   │
  │ Building allowed at +25% scrap cost                      │
  │ Leaks reduce Vigil points; 0 = run over                  │
  └──────────────────────┬──────────────────────────────────┘
  ┌── TALLY ─────────────▼──────────────────────────────────┐
  │ Wave grade from combo tally, leak count, time, damage    │
  │ +5 Vigil restored (cap 30); scrap carried forward        │
  │ Offer: choose 1 of 3 (trap / hex / relic / cursed pick)  │
  └─────────────────────────────────────────────────────────┘
```

**"The Bill" is load-bearing.** In a trap game, hidden wave composition is
hostile design — you cannot plan for a flier you didn't know was coming. The
manifest is fully public in the build phase (icons + counts, e.g. `12×
Dustkin · 3× Buzzard · 1× Gravelung`). Difficulty comes from the composition
being *hard*, never from it being *secret*. Act III adds one twist: the Choir can
add a single unlisted enemy, and it's always announced by a bell toll.

### Site structure

A site is one assembled map (§11) with:

- **1 Rift** — the objective, a grave-well leaking cyan light.
- **2–4 Gates** — spawn points. Later waves activate more gates, which is how a
  site escalates spatially rather than only numerically.
- **4–6 waves**, the last of which is an **elite wave** (a named mini-boss plus
  escort).
- **1–3 environmental trap slots** (rail line, chandelier anchor, chute) — free
  to activate once, then cost salt to reset. Sites that roll these are
  memorable; the generator guarantees at least one per site.

### Round escalation

The curve, as implemented (`sim/tuning.ts` → `ROUND`):

| Knob | Value | Why |
| --- | --- | --- |
| Bodies | `6 + 2.2 per round`, cap 90 | **Count grows faster than HP, until the cap** — a horde game should get *wider*, not spongier. More bodies means more trap chains and more decisions; fatter bodies just means longer |
| Enemy HP | `+11% per round` to round 30, **`+18% per round` after** | The two-regime curve — see below |
| Enemy speed | `+1.6% per round`, capped at 1.55× | Speed is the scariest scalar, so it moves least |
| Spawn interval | `2.1s − 0.075s per round`, floor 0.42s | Pressure comes from *density*, which is what makes a chokepoint build matter |
| Elite round | every 5th | ×0.45 bodies, ×3.4 HP, ×4 payout |
| Vigil restored | +3 per round cleared, capped at 20 | You can bleed and recover, but never fully reset |

#### Two regimes, because the body count runs out of road

This section used to argue flatly that HP scaling is the wrong lever — "fatter
bodies just means longer". That argument is right, and it is right *only until the
body cap*. `6 + 2.2×round` hits the cap of 90 at **round 38**, and past that point
count contributes nothing: speed is already near its own cap, spawn interval is at
its floor, and a game that is supposed to be endless stops getting harder.

So the curve is explicitly two regimes:

| | Rounds 1–30 | Rounds 31+ |
| --- | --- | --- |
| Primary lever | **Count** — `+2.2` bodies/round | **HP** — `+18%`/round, compounding |
| Secondary | HP `+11%`/round | Count until the cap, then nothing |
| What it asks of the player | Cover more lanes; more chains | Kill the same bodies *faster*; deeper chains |

The sponge risk is real and is named here rather than discovered later: at +18%
compounding, a round-45 Dustkin has roughly 5× the HP of a round-30 one. Two
things keep that from turning the late game into chip damage:

- **Trap damage scales with the combo system** (§5) — the player's answer grows
  with the same skill the score measures, rather than with money or unlocks.
- **The cap on bodies is what makes it safe.** Spongy *and* numerous is the
  failure case; spongy *instead of* more numerous is a legible change of pace, and
  it lands exactly where elite rounds have already taught the player to read a
  high-HP enemy.

If the late game still reads as slow in playtest, the order to try is: raise elite
frequency → raise the body cap with a matching HP reduction → only then touch the
+18%. **Lengthening rounds is the failure mode to watch for**, and the round timer
in the wave grade (§4) is the instrument for it.

**New archetypes unlock by round**, not by act: Buzzards (fliers) from round 4,
Rattlers (burrowers) from 7, Gravelung (trap-destroyer) from 10, Lamplight Wisps
(incorporeal) from 13. Each entry follows the §8 rule — first appearance is alone,
in small numbers, in a round with spare budget, so the player gets to *learn* it.

Site variety still comes from procgen (§11) — a new site every few rounds, so the
geometry puzzle refreshes without needing an act break.

---

## 5. Economy, scoring & the poker-hand combo system

### Three currencies

| Currency | Earned by | Spent on | Persists |
| --- | --- | --- | --- |
| **Scrap** | Kills (1–15 by enemy tier), wave clear bonus, selling traps | Placing & upgrading traps, repairs | Whole run |
| **Salt** | Slow passive regen (1 per 4s), salt barrels in the world, some relics | Hexes, resetting one-shot traps, reviving a downed Deputy | Whole run, cap 100 |
| **Ash** | `floor(Tally/1000) × (1 + highestRound/20)` at run end, win or lose | Permanent unlocks: traps, hexes, **weapons**, starting kit | Forever |

#### The round payout

Money arrives in two streams, and the split is the whole incentive design:

| Source | Amount | Purpose |
| --- | --- | --- |
| Per kill, during the round | 4 (×4 for elites) | Keeps you in the room |
| **Round-clear payout** | `45 + 13×round + 2×kills + 55 if no leaks` | The lump you actually build with |

Starting purse: **160** — enough for round 1 to afford the signature pair (Tar 40
+ Vent 55) *and* a Jaws (30) with change. A first round that can't build the combo
the whole catalog is designed around teaches the player nothing, and the first
round is the only one they're guaranteed to see.

Two rules keep this honest:

- **No gold-per-second and no passive income.** Every coin traces to a kill or to
  clearing a round.
- **The payout scales with performance, not just survival.** `2×kills` plus a
  large no-leak bonus means you *can* hide behind traps and still bank money —
  you'll just bank far less than someone in the room. That preserves the "you must
  participate" pillar while still giving the build phase a real budget.

### Tally (score) sources

| Source | Points | Notes |
| --- | --- | --- |
| Enemy killed | tier × 10 | Baseline; unmultiplied |
| Killed by trap | ×1.5 | Traps are the intended answer |
| Killed by player gun | ×1.3 | Rewarded, but less than traps |
| Killed by trap **after** a Boot | ×2.0 | The signature verb |
| Airborne kill | ×1.75 | Stacks with the above |
| **Combo hand** | ×1.2 – ×6.0 on the whole hand | **The dominant term — see below** |
| No-leak wave | +500 | |
| Untouched wave (0 damage taken) | +750 | |
| Speed bonus | up to +400 | Scales inversely with wave duration |
| Vigil unspent at run end | ×25 each | Discourages sandbagging leaks |

**Combos are not one line in that table, they are the table.** A run that kills
everything and lands no hands scores roughly its raw kill points; the same run
played through a working kill box multiplies *every kill in the hand* by up to
6.0×, and that gap widens with the size of the hand (`MAX_HAND` 8). The flat
sources above exist to give a floor and to pay for the behaviours the pillars
want — they are deliberately too small to carry a leaderboard run.

The intent is a specific pressure: **you cannot climb by shooting well.** Ash
comes from Tally (§10), Tally comes from hands, and hands come from bodies dying
in the right order in the right place. That is what makes "build a good kill box"
the actual verb of the game rather than a flavour of optimisation.

### The poker hands (signature system)

Every kill within a rolling **4-second window** appends to the current *hand*,
recording which trap or weapon landed the killing blow. When the window lapses,
the hand is scored and cleared. This is dead-simple to implement, trivially
readable, thematically perfect, and it makes the player *deliberately diversify
and sequence* their build instead of spamming one optimal trap.

| Hand | Condition (within one window) | Multiplier | Design intent |
| --- | --- | --- | --- |
| **Pair** | 2 kills | ×1.2 | Baseline chaining |
| **Two Pair** | 4 kills, 2 distinct sources | ×1.5 | |
| **Three of a Kind** | 3 kills, same source | ×1.8 | Rewards a well-placed single trap |
| **Straight** | 5 kills, 5 *distinct* sources | ×3.0 | Rewards a diverse, wired-together lane |
| **Flush** | 5 kills, all one source | ×2.6 | Rewards a fully upgraded specialist |
| **Full House** | 5 kills = 3 of one + 2 of another | ×2.8 | |
| **Four of a Kind** | 4 kills, same source | ×2.4 | |
| **Straight Flush** | 5 distinct sources *and* ends within 2m of the Rift | ×4.5 | Rewards letting them get terrifyingly close |
| **Dead Man's Hand** | 8 kills, ≥6 distinct sources, no damage taken | ×6.0 | The mastery ceiling. Aces and eights. |

HUD presentation: a fan of playing cards in the bottom-right, one card flipping
face-up per kill, suit = trap family, rank = enemy tier. The hand name stamps
across the cards when it scores. Card flips and the stamp are the juiciest audio
cues in the game (a real card *snap*, a ledger stamp *thunk*).

#### The open hand amplifies trap damage

A hand in progress grants **`+8% trap damage per card, capped at ×1.6`**, lost the
moment the hand closes or breaks. Gun damage is untouched.

This was an open question and it resolves in favour of *yes, but narrowly*, for
one reason: **§4 raises enemy HP steeply, and the player's answer has to scale
with something.** If it scales with money the game becomes an income puzzle; if it
scales with unlocks the difficulty curve inverts (§10 forbids power creep). Making
it scale with *the combo system* means the thing that gets you through round 30 is
the same thing that scores — one skill, not two.

Three guards keep it from becoming a runaway:

- **Traps only.** Amplifying the gun would undercut "traps are the intended
  answer" and hand the reward to the wrong verb.
- **Capped at ×1.6 and lost on close.** It is a rhythm, not a ratchet. A player
  cannot bank it, and a broken chain costs it immediately.
- **It pays nothing to a flailing player.** No hand, no bonus — this is
  deliberately rich-get-richer, which is the correct shape for a skill ceiling in
  a roguelite and the wrong shape for a difficulty floor. The floor is held by the
  Vigil pool (§4) and the round payout, neither of which cares how you are doing.

**The honest risk:** it double-dips, because a good hand already pays in Tally.
That is accepted — the alternative was combos paying only in score, which makes
the signature system a scoreboard decoration in a game whose difficulty comes
from HP. If playtesting shows it trivialising the mid-game, the cap is the dial to
turn first, then the per-card rate; the trap-only restriction is not negotiable.

### Cost curve (starting values to tune)

- Wave 1 income ≈ 120 scrap → buys 3–4 cheap traps (30–45 each).
- Trap costs by family: floor 30–60, wall 45–80, ceiling 70–120, sigil 60–110,
  guardian 150–250.
- Upgrade cost = 1.5× base; second upgrade = 2.5× base.
- Sell refund: 100% during build, 50% during combat.
- Repair cost: 20% of base per 25% durability lost (only traps with durability —
  see Gravelung, §8).

---

## 6. The trap catalog

Traps are **pure data** (§12) — a `TrapDef` JSON plus an optional behaviour hook.
Target: **23 traps** across 5 families, of which **6 are unlocked at the start**
and the rest arrive through Ash unlocks and in-run offers.

### The element system — how "traps work together" is *mechanical*

Synergy can't be a tuning coincidence or a wiki page; it has to be in the rules.
So every trap carries an **element**, applies **statuses**, and the damage pipeline
(`sim/systems/combat.ts` — the single writer of enemy HP) resolves the
interactions. Adding a fire source later inherits every fire interaction for free.

| Element | Traps | What it means |
| --- | --- | --- |
| **iron** | Jaws, most kinetic traps | Plain damage, holds |
| **tar** | Tar Seep | No damage. Applies *soaked* and *slow* |
| **fire** | Brimstone Vent, Ashfall | Damage + *burning*; **triples against soaked** |
| **powder** | Powder Plate | Damage + *launch* |
| **arcane** | Sigil of Nine, hexes | No damage. Applies *marked* |

| Status | Effect | Applied by |
| --- | --- | --- |
| **soaked** | Next fire hit deals **×3**, consumes the soak, and sets them burning | tar |
| **burning** | Damage over time, attributed to fire (so it can crit soaked targets) | fire, ignition |
| **held** | Cannot move, and takes **+25% from everything** | Jaws, Gallows Rope |
| **marked** | Takes **+50%** | Sigil of Nine, Hex Lantern |
| **slowed** | Movement × factor | tar, Barbed Coil |
| **launched** | Airborne: ignores ground effects, takes fall damage on landing | powder, the Boot |

Amplifiers **stack multiplicatively**, which is where the pay-off lives: 10 damage
of fire on a target that is soaked, marked and held is `10 × 3 × 1.5 × 1.25 =
56.25`. That number is asserted in the test suite, because it *is* the design.

#### Traps that change other traps

The strongest expression of the rule, and the one players discover with delight:
**a fire trap sets overlapping Tar alight.** A Tar Seep on its own is a slow; a Tar
Seep with a Brimstone Vent beside it is a burning lake that reapplies fire every
tick for as long as the vent keeps belching. Mechanically the tar trap swaps its
whole effect list for a `litEffects` list while lit.

This is why the answer to "why not just buy the damage trap" is "there isn't one".
**No trap in the starting five is a pure damage dealer**, and two of them (Tar,
Sigil) deal no damage at all.

### Design rules

- Every trap belongs to exactly one **surface family** (floor/wall/ceiling/sigil/
  guardian) and placement is validated against surface tags in the chunk data.
  That one line hid a system; it is specified properly in **§7.1**.
- Every trap has a **combo verb**: does it *damage*, *hold*, *launch*, *amplify*,
  or *convert*? A build needs at least one launcher and one amplifier to reach
  the high hands — that's the deck-building tension.
- Every trap has **exactly two mutually exclusive upgrades**. Never three; never
  linear levels. Two forces identity.
- **Aura damage is authored per second**, proximity/periodic damage per hit. A
  `24` in an aura def is a rate; applying it per tick unchanged would be a 60×
  error.

### 7.1 Surfaces and placement

Everything below the Floor table — six wall traps, four ceiling traps — is
currently unbuildable. M0.5 shipped floor placement only: the ghost snaps to a
grid cell under the crosshair, and `TrapDef` has no surface field at all. This
section closes that, and it is a bigger change than it looks.

**It is not optional polish.** Two of the four archetypes' exclusive traps are
not floor traps: the **Marshal's Hex Lantern is wall-mounted** and the
**Preacher's Church Bell is ceiling-mounted** (§7 tables, and the roster table in
`art-recipes/prompts/character-model.md` §1). Floor-only placement means half the
roster cannot use its signature trap. The deck-building tension above fails the
same way — of six *amplifiers* in the catalog, three are wall and one is ceiling,
so "a build needs at least one launcher and one amplifier" collapses to a couple
of forced picks when only the floor is live.

#### The slot contract

Placement stays a **data question, not a raycast guess** (§11) — that principle
is what makes procgen safe and it does not change. What changes is that a slot
has to describe an oriented patch of surface rather than a point on the ground:

```ts
type SurfaceFamily = 'floor' | 'wall' | 'ceiling' | 'sigil';

interface SurfaceSlot {
  family: SurfaceFamily;
  at: Vec3;                     // a point ON the surface, chunk space
  normal: Vec3;                 // outward: floor +Y, ceiling −Y, wall horizontal
  span: { u: number; v: number };   // extent across the face, metres
  band?: [number, number];      // height above floor a wall slot covers
  capacity: number;             // traps sharing this slot; usually 1
  tags?: ('chalk' | 'unhallowed' | 'timber' | 'stone')[];
}
```

`normal` is the load-bearing addition. It supplies the trap's facing, so a
Scattergun Ports cone fires *out of the wall* rather than in an authored
direction, and a wall's two faces are two different slots.

#### The five systems this touches

1. **Targeting.** A floor ghost snaps to the cell under the crosshair. A wall
   ghost cannot: the player is aiming at a vertical face from a 3.4m boom. So
   placement resolution becomes a camera ray → nearest compatible slot → ghost
   adopts that slot's normal. Same input (arm a slot, LMB to set), different
   resolution step. This is the one genuinely new piece of build-mode code.
2. **Orientation in the sim.** Floor traps are effectively rotation-free; wall
   traps are not. Area tests split into **radius** (floor, sigil), **cone**
   (wall), and **column** (ceiling), and a placed instance stores the yaw its
   slot gave it. The damage pipeline is unchanged — only the shape test is.
3. **Mount height.** A Barbed Coil at ankle height is a strip you walk through;
   a Lodestone at 3m is a pull field overhead. Each wall trap declares the `band`
   it needs, and a slot whose vertical extent does not contain that band is not a
   legal target. This is also what stops a Chandelier Drop being mounted at knee
   height.
4. **The reach preview, which is the part most likely to be got wrong.** §7 above
   promises "the trap's actual reach ring in its element colour". A wall trap has
   no ring — its reach is a cone or strip **projected onto the floor**, offset
   from the trap itself. The preview must draw where enemies get *hit*, not where
   the trap gets *mounted*. A wall trap whose effect area you cannot see before
   buying is a wall trap nobody buys, and the six of them will read as a dead
   branch of the catalog.
5. **Surface supply.** Path A's generator (§17.0) already emits `wallRun`,
   `block`, `pillar` and `steps` as parameterized geometry, so it already knows
   every face and its outward normal. **Emitting wall and ceiling slots is nearly
   free at generation time** — materially cheaper than hand-authoring them in
   Blender, which is another point on Path A's side of the §17.0 table.

#### The failure mode, and the guard

A site with no wall surfaces does not merely lack six traps — it makes the
**Rattler unanswerable**, because §8's invalidation table lists "wall + ceiling
coverage" as the counter to a burrower that ignores floor traps. Boot Hill has
three wall faces and one ceiling anchor *by design* (`GALLOWS_HYMN_MAPS.md` G7),
so this is a live case on the first map, not a hypothetical.

Two guards, both already drafted against the map set:

- **G7, the surface census** — every map declares its floor/wall/ceiling/sigil
  counts, and they are a hard map guarantee (`GALLOWS_HYMN_MAPS.md` §3).
- **Composition constraint 6** — the wave director reads that census and bans
  archetypes the site cannot answer (§8).

**Deliberately not doing:** free placement on arbitrary geometry. More surfaces,
not a different placement philosophy.

### The hotbar

The loadout lives in a **bottom-centre hotbar**, always visible, because in a trap
game the loadout *is* the interface.

**Slot 1 is always the revolver.** Slots `2`–`6` are traps. This is a change from
M0.5, where `1`–`5` were all traps and `Q` was the only way back to shooting, and
the reason is that the old model had two different mental categories bound to one
row: five things you *place* and one thing you *hold*, reachable by different
kinds of key. "How do I shoot again" had a different answer depending on where you
were. Putting the gun in slot 1 makes the row uniform — **the hotbar is everything
that can be in your hands** — and gives the player one key that is always safe to
press.

`Q` is kept, but as a *toggle* rather than an alias: it swaps between the gun and
the last armed trap. `1` is the unconditional one — press it from any state and
you are holding the revolver. The two are worth having separately, because a fast
there-and-back to the trap you were placing is a different motion from "get me out
of build mode", and M0.5 players already have `Q` in muscle memory.

Arming a trap slot drops you straight into build mode; during a round there is no
time for two keystrokes. Pressing `1` leaves build mode the same way. Keys run
`1`–`9` then `0` for the tenth row, the usual convention once a hotbar outgrows a
single digit row. The wheel walks the whole row *including the gun*, so scrolling
past the first trap puts the revolver back in your hands rather than wrapping
around to the last trap — "keep scrolling until I'm shooting" is what players do
under pressure. Left-click sets, right-click sells.

Each slot shows its **icon**, live cost (including the mid-round surcharge), and
element colour. The armed slot lifts and shows **its synergy line in plain
words** — a combo the player can't discover doesn't exist. The placement ghost
draws the trap's actual **reach ring** in its element colour, because a trap whose
radius you can't see is a trap you can't plan around.

#### Slot icons are rendered from the trap's own geometry

M0.5 shipped a text glyph per slot, which is legible but does not tell a new
player what a Stampede Post *is*. The traps need pictures. They must not be
hand-drawn.

Decision 15 already makes every trap a parameterized `BufferGeometry` in
`render/models/traps.ts`. So the icon is generated from that same mesh: at load,
each trap is rendered once through an offscreen orthographic camera into a shared
icon atlas, using the same vertex-colour material it uses in world space.

Three reasons this beats drawing 23 icons:

- **An icon that can drift from the model will.** Retuning a trap's geometry is
  expected and frequent (that is the stated advantage of code-authored props).
  A generated icon updates for free; a drawn one silently starts lying.
- **It costs nothing from the §17.12 art budget**, which is the critical path
  from M4 onward. Twenty-three hand-drawn UI icons is a real chunk of work to
  spend on something the renderer can do at boot.
- It extends the case-study claim from decision 15 — the world, every trap, *and
  the interface that sells them* are generated from code.

The existing glyph stays as the fallback for the frame before the atlas is ready,
so the hotbar never renders empty.

### 7.2 Footprint, and why there are now two grids

**Traps currently overflow the box they are placed in, by about double.** The
placement cell is `1` metre (`sim/sites.ts`), while the widest part in
`render/models/traps.ts` is a 0.96 m-radius cylinder — **1.92 m across**. Placed
side by side, two traps interpenetrate; placed at a wall, a trap hangs through it.
That is not a tuning slip, it is a missing rule.

Two rules fix it, and the second one is the system change.

#### Rule 1 — geometry is contained; effect is not

> **A trap's *mesh* must fit inside its placement cell. A trap's *effect radius*
> may spill as far as it likes.**

The distinction is the whole game. Tar Seep is a 1.5 m pool and Sigil of Nine is a
5 m aura — of course those reach past their box; overlapping areas of effect is
what combos are made of (§6). What may not overlap is the physical object, because
the player reasons about placement by looking at objects. If a trap looks like it
occupies its neighbour's square, the grid stops being a promise.

So every `TrapDef` declares a `footprint` in metres, the model is authored to fit
inside it, and **a test measures it rather than trusting the eye** — the same
posture as `pipeline/budget_check.mjs` takes with art assets. Traps are code, so
the check is a sim test that walks each trap's merged geometry and asserts its XZ
bounds fit within the placement cell minus a small margin. A trap that outgrows
its box fails the build, not the playtest.

#### Rule 2 — the placement grid and the nav grid are separate

Making the boxes bigger sounds like changing one constant. It is not, because
`level.cell` is doing two unrelated jobs at once: it is the resolution of the
**Dijkstra flow field** that 220 units path on *and* the snap size for trap
placement. Raising it to fix the visual problem would:

- coarsen pathing for the entire horde, on the grid §12 keeps deliberately cheap;
- change every §11 guarantee, all of which are computed in cells (pinch detection,
  the 18 m minimum path, reachability);
- invalidate the whole G7 surface census in `GALLOWS_HYMN_MAPS.md`, whose floor
  counts are nav cells — Boot Hill's ~620 becomes ~155 at a 2 m cell.

None of that is wanted. The two numbers only ever shared a variable by accident:
**pathing wants fine, placement wants coarse.**

| Grid | Size | Used for |
| --- | --- | --- |
| **Nav** | **1.0 m** (unchanged) | flow field, reachability, §11 guarantees, the G7 census |
| **Placement** | **2.0 m** | trap snap, footprint containment, the build ghost |

The placement cell is an **integer multiple** of the nav cell, so the mapping is
exact and needs no rounding: one placement box is exactly 2×2 nav cells. A
placement box is legal only if **every** nav cell inside it is placeable — the
conservative direction, which is what stops a trap sitting half on a boardwalk and
half in the air.

2 m is chosen to clear the measured 1.92 m worst case with margin to spare, and
because it is the largest box that still lets Boot Hill's ~620 nav cells resolve
to enough distinct placements (~155) for the map to read as a puzzle rather than a
short list. It is a tuning constant, not a law — but it must stay an integer
multiple of the nav cell.

**Consequence for §7.1:** wall slots inherit the same split. A wall slot's `span`
is quantised to the placement grid, so a 4 m wall run offers two mount points, not
a continuum.

### Floor

| # | Trap | Scrap | Effect | CD | Verb |
| --- | --- | --- | --- | --- | --- |
| 1 | **Jaws of Perdition** (bear trap line) | 30 | Clamps first enemy, 25 dmg + hold 2s | 4s | Hold |
| 2 | **Powder Plate** | 50 | Pressure-triggered keg: 60 dmg in 3m, launches 6m up | 8s | Launch |
| 3 | **Tar Seep** | 40 | Slow 50% in 4m; **ignites** for 3× if any fire source touches it | — | Hold |
| 4 | **Salt Line** | 35 | 0 dmg to corporeal; **80 dmg/s to Choir units**; blocks their phasing | — | Damage |
| 5 | **The Harrow** (spike furrow) | 30 | 18 dmg per pass, retracts | 1.5s | Damage |
| 6 | **Brimstone Vent** | 55 | Fire jet, 30 dmg + burn 5/s for 4s, small launch | 3s | Damage |
| 7 | **Coffin Hatch** | 110 | Trapdoor: **instant kill** on non-boss, 1 enemy | 12s | Damage |
| 8 | **Lime Pit** | 45 | 12 dmg/s, corpses in it grant +50% scrap | — | Convert |

*Upgrade examples.* Jaws → **Rusted** (adds 6/s bleed, hold 1s) or **Wolf Trap**
(catches 3 enemies, no bleed). Powder Plate → **Black Powder** (+40 dmg, no
launch) or **Fool's Charge** (−20 dmg, launch 12m, CD 5s — the combo pick).

### Wall

| # | Trap | Scrap | Effect | CD | Verb |
| --- | --- | --- | --- | --- | --- |
| 9 | **Scattergun Ports** | 70 | 4m cone, 45 dmg, knockback 4m | 3s | Launch |
| 10 | **Barbed Coil** | 45 | Slow 35% + bleed 8/s in a 3m strip | — | Hold |
| 11 | **Stampede Post** (piston ram) | 65 | Launches enemies 10m laterally, 10 dmg | 4s | Launch |
| 12 | **Hex Lantern** | 60 | Marks enemies in 6m: +35% damage taken, reveals in darkness | — | Amplify |
| 13 | **Lodestone** | 80 | Pulls enemies within 8m toward it at 2 m/s | — | Hold |
| 14 | **Gunsmith's Bench** | 90 | Passive: your reloads are 30% faster within 8m | — | Amplify |

### Ceiling

| # | Trap | Scrap | Effect | CD | Verb |
| --- | --- | --- | --- | --- | --- |
| 15 | **Chandelier Drop** | 100 | 120 dmg in 4m, one use; 15 salt to reset | once | Damage |
| 16 | **Church Bell** | 120 | Pulse every 8s: stagger + fear 3s in 7m | 8s | Hold |
| 17 | **Rain of Nails** | 85 | Sustained 22 dmg/s in a 3m cone below | — | Damage |
| 18 | **Buzzard Roost** | 95 | Two birds intercept fliers; 30 dmg/pass | — | Damage |
| 19 | **Sigil of Nine** | 90 | +50% all damage taken inside 5m | Amplify |
| 20 | **Widow's Mark** | 75 | Enemies killed inside burst for 40 dmg in 3m | Amplify |
| 21 | **Wailing Well** | 70 | Kills inside grant +100% scrap and +1 salt | Convert |
| 22 | **Gallows Rope** | 110 | Suspends one large/elite enemy 4s, helpless, taking +100% | Hold |
| 23 | **Ash Circle** | 130 | First enemy killed inside rises as a **Revenant ally** for 20s | Convert |

### Guardians (deployable units — deliberately expensive and fragile)

| # | Unit | Scrap | Effect |
| --- | --- | --- | --- |
| G1 | **Revenant Deputy** | 180 | Raised gunslinger: 25 dmg/shot, 1/s, 250 HP, revive for 20 salt |
| G2 | **Bell Ringer** | 220 | Stationary; pulses fear and reveals Choir units in 12m |
| G3 | **Mine Cart** (site-slot only) | 60 | Runs a rail, 200 dmg to everything on the track, launches |

### Synergy map (the intended "aha" combos)

- **Tar Seep + Brimstone Vent** → ignited tar, 3× damage over a whole lane.
- **Lodestone + Powder Plate** → pull a cluster onto the plate, launch them all.
- **Stampede Post → Scattergun Ports → Coffin Hatch** → the conveyor belt. A
  Straight in one enemy's lifetime.
- **Hex Lantern + Sigil of Nine + any single-target burst** → boss deletion.
- **Ash Circle + Widow's Mark** → your revenant kills inside the mark, chaining
  bursts that themselves feed the hand.
- **Gallows Rope + Church Bell** → total crowd lockdown for a leak-free wave.
- **Salt Line + Hex Lantern** → the only reliable Act III Choir answer, which is
  exactly why both are common offers late.

---

## 7. The hero: weapons, hexes, archetypes

> **Who the hero *is* lives in [`HEROES.md`](HEROES.md)** — the two playable
> bodies (Amos Kell, the marshal; Ada Prewitt, the undertaker), the silhouette
> contract that keeps them apart at 64px, and the one-skeleton-two-part-sets rule
> that makes a second hero affordable against §17.6's 28-clip budget. This
> section stays the owner of the hero's *verbs*.

### Camera — full body, Orcs Must Die framing

Third-person with the **whole character visible**, matching OMD's framing rather
than a tight modern over-shoulder. This is the correct call for a trap game: you
need to see your own feet relative to the trap you're standing on, and the body
is the thing being launched by your own Powder Plate.

| Parameter | Value | Why |
| --- | --- | --- |
| Boom distance | 3.4m | Full body plus headroom; OMD sits around here |
| Boom height | 1.85m (above the feet) | Slightly above the head, angled down 8° so the **ground reads** — a hip-height camera makes a trap game unplayable |
| Shoulder offset | 0.35m right | Enough to un-block the crosshair, not enough to break the centred feel |
| FOV | 75 default, 65–100 slider | |
| Aim-in | boom → 2.6m, offset → 0.5m, FOV → 68, over 120ms | Tightens for precision without a scope |
| Collision | boom springs in on geometry, never clips through walls | Standard spring-arm with a sphere sweep against the static BVH |
| Framing | crosshair-centred, character offset left | Shots go where the crosshair is, always — no gun-origin parallax |

Consequences, all of them accepted deliberately: the full body means the hero
needs the complete 28-clip set (§17.6) including 8-way locomotion and real
turn-in-place, the silhouette must read from behind (hat brim, coat flare,
shoulder line), and the camera has to handle the character being airborne and
tumbling. That's the cost of the OMD feel, and it's worth it.

### Movement

- Ground speed 6.5 m/s, sprint 9.5, air control 0.35, jump apex 1.4m.
- **Coyote time 100ms, jump buffer 120ms** — non-negotiable for a game about
  hopping over your own traps.
- **Slide** (crouch while sprinting): 0.8s, passes under Rain of Nails and
  through Barbed Coil without triggering your own traps. Traps never hurt the
  player, but they do *push* — being launched by your own Powder Plate is a
  legitimate movement tech and should be tuned to feel great, not punished.
- No stamina. Nobody has ever enjoyed stamina in a horde game.

### The Boot (universal, the most important verb)

Hold-to-aim kick, 1.5s cooldown, launches one enemy 8m along the camera forward
vector with 15 damage. Grants the **×2.0 Boot multiplier** if that enemy dies to
a trap within 3s. It is the bridge between the shooter and the tower defense, so
it gets the best animation, the best audio, and generous hit detection (a 1.2m
forward capsule sweep, favouring the nearest enemy to screen centre).

### Weapons

| Weapon | Type | Damage | Rate | Mag | Notes |
| --- | --- | --- | --- | --- | --- |
| **Absolution** (revolver) | Hitscan | 34 (×2.5 head) | 2.5/s | 6 | Default. **Fan-fire**: hold to empty all remaining in 0.6s at 60% damage |
| **Coach Gun** | Hitscan spread ×8 | 12/pellet, knockback 5m | 0.9/s | 2 | The crowd-control/combo weapon |
| **Lever Rifle** | Hitscan, pierces 3 | 45 | 1.4/s | 8 | Lane weapon; rewards standing behind the traps |
| **Hand Cannon** | Projectile, 3m AoE | 90 | 0.7/s | 4 | Self-launch if you shoot at your feet (intentional) |
| **Bowie Knife** | Melee | 60, 0.4s | — | — | Always available; execution finisher on staggered enemies |

Reload is manual, per-round for the revolver (cancellable — a classic and
correct feel decision), and the reload animation is where the character's
personality lives.

### Hexes (spells; cost Salt; 2 equipped slots)

| Hex | Salt | Effect |
| --- | --- | --- |
| **Ashfall** | 25 | 4m circle, 25 dmg/s fire for 5s; ignites Tar |
| **Bindweed** | 20 | Roots everything in 5m for 2.5s |
| **Pale Horse** | 15 | Dash 10m, phase through enemies, brief invuln |
| **Devil's Bargain** | 30 | +75% damage for 8s; you take +50% too |
| **Requiem** | 45 | Channel 3s, immobile: 400 dmg spread over everything in 12m |
| **Last Rites** | 35 | Instantly resets all one-shot traps on the map |
| **Dust Devil** | 25 | Moving vortex, carries enemies 8m along its path (combo tool) |

### Archetypes (chosen pre-run, 4 total)

| Archetype | Signature weapon | Passive | Exclusive trap | Fantasy |
| --- | --- | --- | --- | --- |
| **The Marshal** | Lever Rifle | +25% damage to marked/hexed enemies | Hex Lantern (starts upgraded) | Precision, lanes, discipline |
| **The Preacher** | Coach Gun | Salt regen +100%; hexes cost −20% | Church Bell | Magic-forward, crowd control |
| **The Prospector** | Hand Cannon | +25% scrap from all sources; starts with 60 extra | Powder Plate (starts upgraded) | Explosives and greed |
| **The Undertaker** | Absolution (dual, 12 rounds) | Corpses grant 2 salt; Ash Circle costs −40% | Ash Circle | Minions and attrition |

Two more archetypes are reasonable Ash unlocks later (a **Tinker** who repairs
and over-clocks traps; a **Widow** built around bleed and time-delayed damage) —
scoped as post-launch content, not v1.

### 7.3 Weapon abilities — two per weapon, on `Q` and `E`

Every weapon carries **two abilities, unique to it, on `Q` and `E`**. They are a
property of the *weapon*, not of the character, which matters once weapons become
purchasable (§10): buying the Coach Gun buys Peal and Scattershot with it.

This **replaces** the "one special ability per character on its own key" model
that `art-recipes/prompts/character-model.md` §1 sketched. It is a simplification,
not an addition — each archetype already has exactly one signature weapon, so
"the character's kit" and "the weapon's kit" were always the same list wearing two
names. Folding them means one place to balance and one place to explain, and the
existing four specials survive as each weapon's first ability.

| Weapon | `Q` | `E` |
| --- | --- | --- |
| **Long Account** (lever rifle) | **Dead Reckoning** · 24s — paint a 20m lane; for 8s every shot pierces unlimited targets and crits inside it | **Steady** · 14s — brace: no spread, +40% damage, but you cannot move for 3s |
| **Benediction** (coach gun) | **Peal** · 20s — bell pulse: stagger + fear 3s in 7m, and every trap in 7m deals +50% for 4s | **Scattershot** · 12s — both barrels at once: 16 pellets, 6m knockback, self-launch 5m backwards |
| **Assay** (hand cannon) | **Blasting Charge** · 18s — lob a keg, detonate on command: 100 dmg in 4m, launches 10m up | **Assay Mark** · 16s — tag one enemy: it takes +60% from *traps* and drops triple scrap |
| **Twin Sermons** (paired Absolutions) | **Wake** · 30s — every corpse within 8m rises as a Revenant for 15s (cap 4) | **Fan the Hammer** · 10s — empty both cylinders in 1.5s, 12 rounds, no reload cost |

Each pair is deliberately one **setup** verb and one **payoff** verb, so the two
keys are never interchangeable: Dead Reckoning creates a lane, Steady exploits it;
Peal softens a crowd, Scattershot moves it; Blasting Charge launches, Assay Mark
makes the landing hurt; Wake makes bodies, Fan the Hammer makes bodies.

#### The keys `Q` and `E` were both taken — what moved

This is the awkward part and it is worth recording, because both bindings had
reasons:

| Key | Was | Now | Why the move is cheap |
| --- | --- | --- | --- |
| `Q` | Build-mode toggle | **Weapon ability 1** | Redundant since decision 17 — `1` unconditionally puts the revolver in your hands, and arming any trap slot enters build mode. The toggle was a convenience with a full-time key |
| `E` | The Boot | **Weapon ability 2** | The Boot is *already* bound to middle mouse as well (`host/input.ts`), described there as wanting to be "reachable without leaving WASD" — so it does not lose its ergonomic home |
| `V` | — | **The Boot** (keyboard) | Keeps a keyboard binding for the signature verb alongside MMB |

The Boot stays §7's most important verb and keeps two bindings. Nothing lost a
binding entirely.

---

## 8. Enemy roster & the wave director

### The invalidation table (the most important design artifact in the game)

| Enemy | Tier | Invalidates | Counter |
| --- | --- | --- | --- |
| **Dustkin** | 1 | — (horde filler, teaches everything) | Anything |
| **Coyote Pack** (×4) | 1 | Single-lane builds — they path to the *least trapped* route | Cover both lanes, or Lodestone |
| **Ironjaw** | 2 | Chip damage (immune to <20 per hit) | Powder Plate, Chandelier, Hand Cannon |
| **Hollow Preacher** | 2 | Slow attrition — heals 15/s in 8m and cleanses slows | Kill it yourself; it's a priority target for *your gun* |
| **Rattler** | 2 | **Floor traps** — burrows past them, surfaces at the Rift's ring | Wall + ceiling coverage, Hex Lantern to reveal |
| **Buzzard** | 2 | **Floor and wall traps** — flies | Ceiling traps, Buzzard Roost, your gun |
| **Gravelung** | 3 | **Permanent trap installs** — spits acid, damages trap durability | Kill at range; Gallows Rope; repair economy |
| **Tumbleweed Hex** | 2 | Trap density — rolls in, detonates, destroys traps in 3m | Kill before contact; Bindweed |
| **Deadeye** | 3 | **Standing still** — snipes you from a gate, 25 dmg, telegraphed laser | Break line of sight, or go kill it |
| **Bone Bride** | 3 | **Chokepoints** — blinks 12m past the first pinch | Layered defence in depth, Salt Line |
| **Lamplight Wisp** | 3 | **All physical traps** — incorporeal, phases walls | Salt Line, sigils, hexes, Bell Ringer |
| **Chain Gang** (×5 linked) | 3 | — (combo food; damage shared across the chain) | Enjoy your Flush |
| **Stagecoach Hearse** | 4 | Burst damage — 3000 HP siege unit that spawns Dustkin as it rolls | Sustained lane damage, Sigil of Nine stacking |
| **Marrow Colossus** | 4 | Everything cheap — elite escort unit, armoured, 2500 HP, breaks barricades | Focus fire + amplifiers + Gallows Rope |

Fourteen archetypes is the right number: enough that the director always has a
question to ask, few enough that all of them can be hand-modelled and animated
to a high standard (§17). Variants (armoured Dustkin, burning Coyote) are
palette + stat swaps on existing rigs, which is how the roster *feels* like 25
for the cost of 14.

> **As built:** six of the fourteen are live — Dustkin, Coyote, Ironjaw,
> Hollow Preacher, Buzzard, Marrow Colossus. Their bodies, silhouette
> contract, as-built stat rationale and the deferred-behaviour ledger live in
> [`ENEMIES.md`](ENEMIES.md), the roster's companion doc (the pattern
> `HEROES.md` set for §7).

### The wave director

Budget-based, seeded, and constrained — never a raw random draw.

```ts
interface WaveSpec {
  index: number;
  budget: number;              // threat points, curve below
  trickles: number;            // 3–5 spawn pulses
  gates: GateId[];             // which gates are live this wave
  guaranteed?: EnemyId[];      // director-forced teaching picks
  banned?: EnemyId[];          // constraint output
  modifiers?: WaveModifier[];  // "night" (darkness), "hymn" (all enemies +10% speed)
}
```

- **Budget curve:** `budget(w) = 100 * 1.28^w * actMult * anteMult`, where
  `actMult` = 1 / 2.2 / 4.0. Exponential, but the *composition* rules below stop
  it from being a flat scale-up.
- **Composition constraints** (hard rules the picker must satisfy):
  1. Never more than **two** "invalidator" archetypes (Rattler, Buzzard, Wisp,
     Bone Bride) in the same wave before Act II.
  2. An invalidator's **first appearance** in a run is always alone, in small
     numbers, in a wave with ≥30% spare budget — the player gets to *learn* it.
  3. Every wave contains ≥40% tier-1 filler by count. Horde games feel bad
     without a horde.
  4. Never spawn a Deadeye at a gate with direct line of sight to the Rift
     platform (unfair, unfun).
  5. Wave 4+ of any site introduces exactly one **new** archetype relative to
     that site's earlier waves, if any remain unspent.
  6. **Read the site's surface census (§7.1, `GALLOWS_HYMN_MAPS.md` G7) and ban
     archetypes the site cannot answer.** An enemy whose only counter is a
     surface the map does not have is not difficulty, it is a map with no answer.
     Concretely: ban Rattler where `ceiling + wall < 8`; cap Buzzard count at
     `2 × ceiling`; require `sigil ≥ 4` before a Lamplight Wisp may spawn.
     Constraint 4 is affected by the same logic — Hollow Creek lets the *player*
     open new lines of sight mid-site, so the Deadeye line-of-sight check is not
     a one-time bake; it re-runs whenever the geometry does.
- **Trickles:** budget is split across pulses with a 6–10s gap, front-loaded
  60/25/15. Fliers arrive on their own trickle so the player has a reason to
  switch weapons. Big units arrive last.
- **Telegraphing:** each trickle plays a distinct pre-spawn audio cue at its
  gate 1.5s early, and the gate's lantern flares. Never spawn something behind
  the player without a cue.

### Enemy AI

Deliberately simple and cheap, because forty of them must be readable:

```
state: SPAWNING → TRAVELLING → (ENGAGING_TRAP | ENGAGING_PLAYER) → DYING
```

- **TRAVELLING** samples the flow field toward the Rift (§15). No per-enemy A*.
- **ENGAGING_PLAYER** only if the player is within `aggroRadius` (4–12m by type)
  *and* within line of sight (one BVH ray, budgeted to N checks per tick). Most
  units ignore the player entirely — enemies that beeline for you turn the game
  into a shooter and away from a trap game.
- **ENGAGING_TRAP** for Gravelung/Tumbleweed only.
- Everything is a **utility score** over 4–6 considerations, not a behaviour tree.
  Cheaper, easier to tune, easier to make deterministic.
- **Think budget:** at most 40 utility re-evaluations per tick, round-robin
  across the population; steering and animation run every tick for everyone.

---

## 9. Bosses

Three act bosses, each of which must be beatable *only* by combining traps and
gun — a boss you can kite and shoot is a failure of the premise.

### Act I — **The Hanging Judge**

A gallows-tall figure in a circuit judge's coat, dragging his own noose. 4,000 HP.

- **Verdict:** marks a 6m circle; anything inside in 3s takes 200 damage. Forces
  you to move *and* means he can be lured onto your own traps.
- **Contempt:** summons a Chain Gang that must be killed to remove his damage
  reduction (−70%) — so the player must keep clearing horde *while* fighting.
- **Sentence:** at 50%, hangs one of your Guardians (destroyed) and gains a
  stack. Punishes turtling behind Deputies.
- **Design lesson taught:** amplifier sigils are how you kill big things.

### Act II — **Mother Amaranth**

The mine itself, sort of: a woman of ore and root growing out of Shaft Nine's
wall. Stationary. 9,000 HP. This is the **reverse-defense** fight — she doesn't
come to the Rift, she spawns waves that do, and you must burst her between them.

- Two phases separated by a wave you have to survive.
- Her roots **destroy trap placements** in a slow sweeping arc, so the arena
  changes and you rebuild mid-fight (scrap is granted generously here).
- Weak point: three ore-hearts that must be shot, in the dark, by lantern light.

### Act III — **The Ninth Bell / The Choirmaster**

A bell the size of a church, ringing with no clapper, wearing a congregation.
14,000 HP across three phases.

- **Phase 1 — The Toll.** Every 12s, a pulse *disables all traps in 8m* for 4s.
  The whole fight is about building redundantly, in depth.
- **Phase 2 — The Congregation.** Splits into three Choirmasters, each
  incorporeal; only salt, sigils and hexes work. The purest test of the Act III
  answer set.
- **Phase 3 — Silence.** All ambient audio and music cuts to nothing but your own
  footsteps and the enemies. Pure mechanical execution with no cues except what
  you can see. (Cheap to build, unforgettable, and a genuine flex.)

---

## 10. Roguelite meta: offers, relics, camps, ante

### Offers (after every wave)

Three cards, one pick. Weighted draw from pools by rarity, with an anti-frustration
rule: **if the player has no answer to an enemy type present in the next two
waves, one card is forced to be an answer.** (No flier answer and Buzzards
incoming? A ceiling trap or Buzzard Roost is guaranteed on offer.) This is the
difference between "hard roguelite" and "unfair roguelite."

| Card type | Weight | Example |
| --- | --- | --- |
| **Trap** (new, or upgrade an owned one) | 40% | *Stampede Post* — or upgrade *Jaws* → *Wolf Trap* |
| **Relic** (permanent run passive) | 30% | *Bootblack's Rag* — Boot cooldown −40% |
| **Hex** | 12% | *Dust Devil* |
| **Consumable/scrap** | 10% | 150 scrap, 40 salt |
| **Cursed pick** | 8% | Take a Curse, get a Rare relic + 200 scrap |

### Relics (~30, four rarity tiers)

Written as flat, legible rules text. A sample across the tiers:

- **Common** — *Ledger of the Dead*: +10% scrap. *Iron Fillings*: Salt Line +50%
  length. *Spare Hammer*: repairs cost half.
- **Uncommon** — *Widow's Veil*: the first hand each wave is auto-upgraded one
  tier. *Powder Horn*: launches deal 25 damage on landing. *Kerosene*: all fire
  effects also apply Tar.
- **Rare** — *Aces & Eights*: Dead Man's Hand also restores 3 Vigil. *Cartwright's
  Rail*: place one Mine Cart rail anywhere, once per site. *Nine-Fingered Deal*:
  every 9th shot is a guaranteed critical.
- **Cursed** (always paired with a Curse) — *The Bell's Ear*: hexes cost 0 salt,
  but the Choir always knows where you are. *Gravedigger's Debt*: +100% Ash from
  this run; you start each site with 10 Vigil instead of 20.

Design rule: **no relic may be purely numeric above Uncommon.** Rares must change
a decision, not a coefficient.

### Curses (the difficulty knob you opt into)

*Wet Powder* (Powder traps −30%), *Long Night* (darkness on every site),
*Hungry Ground* (traps cost +25%), *The Choir Listens* (one unlisted enemy per
wave), *Thin Veil* (all enemies +15% speed), *Paupers' Field* (−1 trap slot).

### Camp nodes (between sites)

Pick two of four:

- **The Shop** — buy traps/relics/salt with scrap.
- **The Forge** — upgrade one owned trap free.
- **The Shrine** — offer 3 Vigil for a Rare relic.
- **The Gallows** — remove one Curse, or convert a Curse into Ash.

### Meta progression (Ash)

`Ash = floor(Tally / 1000) × roundMult` where `roundMult = 1 + highestRound / 20`
— so a deep run always out-earns a shallow one, and since there is no "win", every
run pays. **Both terms are needed and neither is sufficient:** Tally alone rewards
a short flashy run, highest round alone rewards turtling. The product forces the
thing the game is actually about, which is surviving deep *while* killing well.

Spent in the **Coffin** (the between-runs menu, a literal undertaker's workshop):

1. **Unlock pool** — new traps and hexes enter the offer pools.
2. **Weapons** — each of the four weapons and its two abilities (§7.3), bought
   outright. The starting revolver is free; the rest are the most expensive thing
   in the game.
3. **Starting kit** — an extra trap slot, +50 scrap, a chosen relic.
4. **Ante ladder (I–XII)** — post-win difficulty tiers, each stacking a permanent
   Curse. Ante VIII+ is where the leaderboard lives.

#### Prices, and why they are steep

Deliberately slow. A good early run banks single-digit Ash; the numbers below are
set so that **a weapon is a goal you work toward across a dozen runs**, not a
thing you stumble into.

| Purchase | Ash | Roughly |
| --- | --- | --- |
| A trap enters the pool | 40 – 120 | 2–5 good runs |
| A hex enters the pool | 60 – 150 | |
| Starting-kit upgrade | 80 – 200 | |
| **A weapon (with both abilities)** | **400 – 900** | **10–25 good runs** |
| Ante unlock | earned, not bought | |

Worked example: a competent run — round 22, Tally ~46,000 — pays
`floor(46000/1000) × (1 + 22/20)` = `46 × 2.1` ≈ **96 Ash**. That is one trap
unlock, or a ninth of the cheapest weapon. A poor run at round 8 with Tally 6,000
pays `6 × 1.4` ≈ **8**.

The steepness is the point, and it is what makes the §5 scoring change bite: since
Tally is dominated by combo hands, **the only way to afford a weapon in reasonable
time is to get good at kill boxes.** Grinding shallow runs is mathematically
possible and practically hopeless, which is the correct incentive.

Unlocks must stay **horizontal** — new *options*, not bigger numbers, or the game
gets easier as it should be getting harder. Weapons are the sharpest test of that
rule: each of the four is a different *verb set* (§7.3), not a damage upgrade, and
the free starting revolver must remain competitive at every ante. If a bought
weapon ever reads as strictly better than the revolver, the price was not the
problem — the design was.

---

## 11. Procedural site assembly

The hard constraint: procgen must produce maps that are *good trap puzzles*, and
random geometry is famously bad at that. The answer is **hand-authored chunks +
graph-first generation + machine validation**.

> **See `GALLOWS_HYMN_MAPS.md`** for the five hand-authored **anchor sites** that
> seed the chunk library, supply step 5's guaranteed-valid fallback, and cover
> rounds 1–3 and the milestone rounds. It also adds the **surface census** — a
> per-site count of floor/wall/ceiling/sigil placements that the wave director
> must read before it may spawn an archetype the site cannot answer (composition
> constraint #6), and two deliberate, named breaks of the guarantees below.

### Chunk format

- Footprint: **16m × 16m**, on a **4m** placement grid. Height 8m (2 storeys) or
  16m for atria.
- Four edge connectors (N/E/S/W), each typed: `wall | open | door | rail |
  vertical | window`. Connectors only join compatible types.
- Authored in Blender as one collection per chunk, exported with metadata:

```ts
interface ChunkDef {
  id: string;                       // "creek_saloon_02"
  kit: 'boothill' | 'creek' | 'shaft' | 'reliquary';
  connectors: Record<Dir, ConnectorType>;
  tags: ChunkTag[];                 // 'pinch' | 'atrium' | 'vertical' | 'dark'
                                    // | 'rail' | 'trap_rich' | 'sniper_perch'
  surfaces: SurfaceSlot[];          // oriented placement patches — see §7.1
  envSlots: EnvTrapSlot[];          // rail line, chandelier anchor, chute
  collision: string;                // collision mesh name
  navHint?: NavHint[];              // manual nav clamps for awkward geometry
  cost: { tris: number; drawCalls: number }; // baked by the pipeline, budget-checked
  weight: number;                   // draw weight
  minAct: 1 | 2 | 3;
}
```

Trap placement is validated against `surfaces`, so "can I put a Chandelier here"
is a data question, not a raycast guess. **This is what makes procgen safe** —
the level designer (you, in Blender) has already declared where traps make sense.
A `SurfaceSlot` is an *oriented patch*, not a point: it carries the outward
normal that gives a wall trap its facing, and the height band a wall trap must
fit inside. §7.1 has the full shape and the reasoning. Under Path A the generator
emits these itself, since parameterized geometry already knows its own faces.

### Generation algorithm (graph first, geometry second)

```
1. SEED       run seed + act + siteIndex → one PRNG stream (pure-rand)
2. SKELETON   choose site size (7–12 chunks) and place the Rift node
3. GROW       weighted random walk outward to place 2–4 Gate nodes,
              targeting a path length of 4–7 chunks per gate
4. BRAID      add 1–3 extra edges for loops (Coyote alt-routes) — never
              so many that lanes become unreadable
5. VALIDATE   on the *graph*, cheaply, before any geometry exists:
                • every gate reaches the Rift
                • ≥1 'pinch' chunk on ≥half the gate paths
                • ≥1 'trap_rich' or envSlot chunk in the site
                • ≥1 'vertical' chunk from Act II on
                • no two identical chunk ids adjacent
                • total tris/drawCalls under the site budget
              fail → mutate (swap one chunk) and retry, ≤40 attempts,
              then fall back to a hand-authored guaranteed-valid layout
6. INSTANTIATE geometry, merge per-material, build the static BVH
7. BAKE       navmesh (recast) + one flow field per gate, in a worker
8. VERIFY     agent-radius path from each gate to the Rift exists on the
              *baked navmesh* (catches geometry-vs-graph disagreements)
```

Steps 1–5 cost <5ms. Only a graph that passes cheap validation gets expensive
geometry — which is why this is fast enough to regenerate on demand for a "reroll
site" debug key and for automated tests over thousands of seeds.

### Guarantees the generator must never break

1. There is always at least one **pinch** — a place where a good build pays off.
2. There is always a **safe build ring** of ≥4m around the Rift with no gate line
   of sight into it.
3. The player can always **traverse** from the Rift to every gate on foot in
   ≤20s (so you can go deal with a Deadeye).
4. No enemy path is shorter than **18m** (or wave 1 is un-buildable).
5. Total site geometry ≤ **180k triangles** and ≤ **40 draw calls** after merging.

### Testing procgen

A node test that generates **5,000 seeds per act** and asserts every guarantee,
plus a histogram check that chunk usage is reasonably uniform (no chunk appearing
in >60% or <2% of sites). Committed as a CI job — procgen regressions are silent
and lethal otherwise.

---

## 12. Technical architecture

### 12.1 Why a separate Vite sub-app

The portfolio is CRA (`react-scripts` 5 + `react-app-rewired`, webpack 5) on
**React 18**. That matters concretely:

- The current `@react-three/fiber` (9.7.0), `drei` (10.7.8), `@react-three/rapier`
  (2.2.0) and `@react-three/postprocessing` (3.0.4) all **peer-require React 19**.
  Staying in CRA would pin the game to R3F 8.18 / drei 9.122 / rapier 1.5 — a
  maintenance line, not the current one.
- A game needs Web Workers, WASM, KTX2 transcoders, GLSL imports, top-level await
  and content-hashed asset manifests. CRA's webpack config can be beaten into
  most of that via `config-overrides.js`, but every one of those is a fight, and
  `config-overrides.js` is currently **empty** — meaning the portfolio build is
  vanilla and worth keeping that way.
- Bundle isolation: the game will be 2–4MB of JS. It must never be able to leak
  into the portfolio's initial chunk graph, even by accident.

So: `game/` is its own npm project with its own `package.json`, its own React
(19), its own TypeScript, and its own Vite build. The portfolio and the game share
**nothing but the deploy output and one API function.** The portfolio's dependency
tree is untouched by this project — which is the single best architectural
property of this plan.

### 12.2 The layer cake

```
┌─────────────────────────────────────────────────────────────┐
│ REACT SHELL (React 19)                                      │
│  title, coffin/meta menus, settings, offer cards, HUD        │
│  Reads a snapshot store; NEVER inside the frame loop         │
└───────────────▲─────────────────────────┬───────────────────┘
                │ events (kills, offers)  │ commands (intents)
┌───────────────┴─────────────────────────▼───────────────────┐
│ GAME HOST  — owns the rAF loop, accumulator, scene lifetime  │
└───────┬─────────────────────────────────────────┬───────────┘
        │ fixed 60Hz                              │ every frame
┌───────▼──────────────────┐          ┌───────────▼───────────┐
│ SIMULATION (pure, det.)  │          │ PRESENTATION           │
│ bitECS world, systems     │ ───────► │ three.js scene, VAT    │
│ no three.js, no DOM,      │ snapshot │ instancing, VFX, post  │
│ no wall clock, no Math.   │  + lerp  │ audio voices, camera   │
│ random                    │          │ interpolated at alpha  │
└───────┬──────────────────┘          └───────────────────────┘
        │ async requests (transferables, Comlink)
┌───────▼───────────────────────────────────────────────────────┐
│ WORKERS  nav.worker (recast + flow fields) · gen.worker        │
│          (site graph) · loader pools (draco/meshopt/ktx2)      │
└───────────────────────────────────────────────────────────────┘
```

**The one rule that keeps this honest:** the simulation module may not `import`
three.js, React, or anything touching `window`. Enforce it with an ESLint
`no-restricted-imports` rule scoped to `src/sim/**`. Without that rule, the
boundary rots within a month, determinism dies, and the headless tests stop
working.

### 12.3 The frame loop

```ts
const STEP = 1 / 60;              // 16.666ms sim tick
const MAX_STEPS = 5;              // catch-up ceiling; beyond this we drop time

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  accumulator += dt;

  let steps = 0;
  while (accumulator >= STEP && steps < MAX_STEPS) {
    input.flushToCommandQueue(tick);       // coalesce this frame's intents
    sim.step(tick, commandQueue.take(tick)); // pure, deterministic
    tick++;
    accumulator -= STEP;
    steps++;
  }
  if (steps === MAX_STEPS) accumulator = 0; // never accumulate debt

  const alpha = accumulator / STEP;
  present.sync(sim.snapshot(), alpha);     // interpolate prev→cur transforms
  present.render();
  requestAnimationFrame(frame);
}
```

Notes that matter:

- **Double-buffered transforms.** Each entity stores `prevPos`/`curPos` and
  `prevRot`/`curRot`; presentation lerps/slerps by `alpha`. Without this, a 60Hz
  sim on a 144Hz monitor judders visibly.
- **Input is sampled per *frame*, applied per *tick*.** Look deltas accumulate and
  are consumed by the next tick; buttons are latched so a click between ticks is
  never dropped (this is why "my shot didn't register" bugs happen).
- **Camera runs at frame rate, not tick rate**, reading the interpolated hero
  transform. A 60Hz camera on a high-refresh display feels broken even when the
  sim is fine.
- **Pause = stop calling `sim.step`.** Presentation keeps rendering, so the pause
  menu can blur the live scene.

### 12.4 ECS

**bitECS**, pinned to **0.3.40** — struct-of-arrays over typed arrays, zero
allocation per entity, dense iteration, and (critically) deterministic query
order. Note: **0.4.0 is a full API rewrite**; do not take it mid-project. Pin
0.3.40, and evaluate 0.4 only at a natural break.

(If bitECS's verbosity becomes a drag, `miniplex` 2.0.0 is the ergonomic
alternative — object-based archetypes, much nicer to write, but it allocates per
entity and iterates objects. Fine for 200 entities, wrong for 2,000 particles.
Recommendation: bitECS for the sim, plain pooled classes for VFX.)

**Components** (all typed arrays):

```
Transform      x,y,z, rx,ry,rz,rw          (+ prev* mirror for interpolation)
Velocity       vx,vy,vz
Health         hp, max, armour, lastHitTick
Locomotion     speed, accel, turnRate, groundY, flags(flying|burrowing|phasing)
NavAgent       gateId, fieldSample, radius, repathCooldown
AIState        state, target, thinkBudgetSlot, utilityCache[6]
EnemyType      defId  (indexes the static EnemyDef table)
TrapInstance   defId, cooldownTick, charges, durability, upgradeId, ownerTick
Damageable     team, hitboxRadius, headOffsetY
StatusStack    slow, burn, bleed, mark, root, fear  (each: magnitude + expiryTick)
Projectile     defId, spawnTick, lifetime, prevX/Y/Z (for swept collision)
Corpse         decayTick, sourceId
ScoreSource    lastKillerKind, lastKillerId       (feeds the poker hand)
```

**System order per tick** (fixed, documented, never reordered casually — order
*is* gameplay):

```
 1  CommandSystem        apply player intents from the queue
 2  DirectorSystem       spawn trickles per WaveSpec
 3  StatusSystem          tick burn/bleed/slow/root expiry
 4  ThinkSystem           budgeted utility AI (≤40 agents/tick)
 5  NavSystem             consume worker paths; sample flow field
 6  LocomotionSystem      steering + integrate velocity
 7  SeparationSystem      spatial-hash crowd relaxation (2 iterations)
 8  CollisionSystem       capsule/cylinder vs static BVH; ground clamp
 9  TrapTriggerSystem     proximity/pressure/LOS triggers, cooldowns
10  ProjectileSystem      swept segments vs BVH + enemy hash
11  DamageSystem          resolve queued damage events, armour, amplifiers
12  DeathSystem           kill, corpse spawn, scrap/salt award
13  ComboSystem           append to hand, evaluate window, score
14  ObjectiveSystem       leaks, Vigil, wave-complete
15  EventFlushSystem      drain the event ring buffer to presentation/audio/UI
16  SnapshotSystem        copy cur→prev, write the presentation snapshot
```

**Damage is always an event, never a direct mutation.** `DamageSystem` is the only
writer of `Health`. This makes amplifiers, armour, shields and the combo attribution
trivially correct and single-sourced — and it makes damage numbers, floating text
and audio a *read* of the event stream rather than sixteen call sites.

### 12.5 Zero-allocation discipline

GC pauses are the #1 cause of "why does it hitch every 3 seconds" in browser
games. Rules, enforced by review and by a heap-growth test in CI:

- **Pool everything with a lifetime:** entities, projectiles, particles, decals,
  damage-number widgets, audio voices, event objects. Every pool is a fixed-size
  ring with a high-water mark logged in dev.
- **Scratch math only.** A module-level pool of `Vec3`/`Quat` scratch objects
  (`const t = scratch.vec3()` inside a system, released implicitly by a per-system
  reset). No `new THREE.Vector3()` below the loader.
- No array literals, object literals, closures, `.map`/`.filter`, template
  strings, or spread in any per-tick or per-frame path. Use indexed `for` loops.
- No `structuredClone`, no JSON in the loop.
- Events go into a preallocated **SoA ring buffer** (parallel typed arrays +
  `kind` discriminant), not an array of objects.
- Strings are interned to numeric ids at load; the sim never touches a string.

### 12.6 Data-driven content

All content is TypeScript-typed JSON, loaded and validated at boot (Zod or a
hand-rolled validator — hand-rolled is fine and avoids a dependency):

```
game/content/
  traps/*.json        TrapDef      (cost, family, surfaces, effects, upgrades)
  enemies/*.json      EnemyDef     (hp, speed, tier, threat, immunities, model, clips)
  relics/*.json       RelicDef     (rules text + typed effect hooks)
  hexes/*.json        HexDef
  chunks/*.json       ChunkDef     (emitted by the Blender export pipeline)
  waves/*.json        director curves and composition constraints per act
  balance.json        global tuning: costs, multipliers, curves
```

Effects are declarative where possible (`{ kind: 'damage', amount: 45, radius: 3,
falloff: 'linear' }`) and fall back to a named hook (`{ kind: 'script', fn:
'ashCircleRaise' }`) resolved from a registry — so 80% of content needs no code
and the 20% that does is explicit and findable.

Two payoffs: **hot-reload** (Vite HMR on JSON re-seeds balance without a restart,
which is worth days of tuning time) and **a real balance workflow** — one
`balance.json` diff is reviewable in a way scattered constants never are.

---

## 13. Determinism & the co-op-ready contract

We're shipping single-player, but the ~10% extra discipline now is what makes
co-op a transport layer later instead of a rewrite. It also buys three things we
want *immediately*: free bug repro (a seed + a command log reproduces any crash),
ghost replays and attract-mode footage, and plausible leaderboard verification.

### The contract

1. **State only changes inside `sim.step(tick, commands)`.** Nothing else writes
   sim state. Ever.
2. **All randomness comes from seeded streams.** `pure-rand` (8.4.2) xoroshiro128+,
   with **separate jumped streams per concern**:
   `sim.combat`, `sim.director`, `sim.loot`, `procgen.site`, `vfx.cosmetic`.
   Cosmetic randomness *must* be on its own stream, or adding a spark effect
   shifts every combat roll and every replay breaks.
3. **No wall clock in the sim.** Time is `tick`. `Date.now()`/`performance.now()`
   are banned below the host layer (ESLint rule).
4. **Stable iteration order.** bitECS dense arrays iterate deterministically, but
   entity recycling can permute order after deaths. Where order affects outcome
   (damage application to overlapping targets, offer draws), sort by a
   monotonically increasing `spawnId`, never by array position.
5. **Beware transcendental math.** `Math.sin/cos/tan/pow/exp/log` are
   **implementation-defined** in JS — V8 and SpiderMonkey give different last
   bits. Same-binary/same-browser determinism is fine, but for cross-browser
   lockstep co-op it isn't. Mitigation, cheap to do now: a `sim/math.ts` with our
   own `sin`/`cos` (lookup table + lerp, 4096 entries — also faster) and
   `sqrt`-only distance math. `Math.sqrt` and basic arithmetic **are** exactly
   specified by IEEE-754, so they're safe.
6. **Physics engine stays out of the authoritative sim** (see §15.4). This is the
   biggest determinism decision in the plan.
7. **Commands are the only input:**

```ts
type Command =
  | { t: 'move';  x: number; y: number }            // quantized to 1/1000
  | { t: 'look';  yaw: number; pitch: number }      // quantized
  | { t: 'fire' | 'altFire' | 'reload' | 'boot' | 'jump' | 'slide' }
  | { t: 'hex';   slot: 0 | 1 }
  | { t: 'place'; trapId: number; cell: number; rot: 0|1|2|3 }
  | { t: 'sell' | 'upgrade'; instanceId: number }
  | { t: 'startWave' };

interface TickInput { tick: number; playerId: number; cmds: Command[]; }
```

Quantize float commands before they enter the sim. Unquantized mouse deltas are
the classic desync source, and quantizing also shrinks the replay log.

8. **Replay = `{ version, buildHash, seed, archetype, ante, TickInput[] }`.**
   A run of 40 minutes at 60Hz is ~144k ticks; with sparse commands and RLE this
   compresses to tens of KB — small enough to store in Postgres per leaderboard
   entry.
9. **State hash per N ticks.** FNV-1a over the sim's typed arrays every 600 ticks
   (10s), recorded in the replay. Tests assert hash equality on replay; in co-op
   this becomes the desync detector for free.

### What co-op would then need (explicitly out of scope now)

A transport with authoritative-host lockstep-with-delay (2–3 tick input delay is
imperceptible for PvE and vastly simpler than rollback), plus a relay. Vercel
Hobby serverless **cannot** hold socket state, so this means PartyKit,
Cloudflare Durable Objects, or Colyseus on Fly.io. The sim needs no changes; the
host gains "wait for remote input before stepping." Second player = second
`playerId` in the command stream, which the architecture already models.

---

## 14. Rendering plan & performance budgets

### 14.1 Frame budget at 1080p / 60fps (16.6ms), "High" tier

| Stage | Budget | Notes |
| --- | --- | --- |
| Sim (all 16 systems) | **3.0ms** | at 200 enemies + 40 traps |
| — of which AI think | 1.0ms | budgeted round-robin |
| — of which collision/separation | 1.0ms | spatial hash, 2 relax iterations |
| Presentation sync + interpolation | 1.2ms | writing instance attribute buffers |
| VFX/particles CPU | 0.8ms | emitters only; simulation is on GPU |
| Render submit (CPU) | 2.5ms | ≤250 draw calls |
| Audio | 0.3ms | |
| React/HUD | 0.2ms avg | only re-renders on event, never per frame |
| Slack for GC/browser | 2.0ms | |
| **GPU** | **≤10ms** | separate pipeline; the real ceiling on integrated GPUs |

### 14.2 Content budgets

| Thing | High | Med | Low |
| --- | --- | --- | --- |
| Simultaneous enemies | 220 | 140 | 80 |
| Draw calls | 250 | 180 | 120 |
| Triangles on screen | 1.2M | 700k | 400k |
| Shadow-casting lights | 1 CSM (3 cascades, 2048) | 1 (2 cascades, 1024) | 0 (baked + blobs) |
| Dynamic point lights | 8 | 4 | 2 |
| Particles alive | 20k | 8k | 3k |
| Decals | 256 | 128 | 48 |
| Post stack | bloom + tonemap + grain + vignette + shafts | bloom + tonemap | tonemap only |
| Render scale | 1.0 (DPR ≤1.5) | 0.85 | 0.7 |
| Texture memory | 96MB | 64MB | 40MB |

Tier detection: **`detect-gpu` 5.0.70** at boot for the initial guess, then
**dynamic resolution scaling** as the real safety net: EMA of frame time over 30
frames; if >15ms for 20 frames, drop render scale by 0.05 (floor 0.6); if <12ms
for 120 frames, raise it (ceiling 1.0). Never auto-change anything *except*
render scale mid-run — silently dropping shadows mid-wave is more jarring than
a soft resolution dip. All tier settings are user-overridable.

### 14.3 The crowd problem — how 220 enemies cost 2 draw calls

Standard three.js `SkinnedMesh` is one draw call each with CPU-side bone matrix
uploads. At 220 units that's a non-starter. Solution, tiered by importance:

**Tier A — the horde (200+ units): Vertex Animation Textures (VAT).**
Bake every enemy animation clip offline into a float texture: rows = frames,
columns = vertices, RGB = object-space position (a second texture for normals, or
derive them per-frame in the shader). The mesh is an `InstancedMesh`; a custom
vertex shader samples the texture at `(vertexId, clipStart + fract(time) * clipLen)`
and needs **no bones, no mixers, no CPU work**. Per-instance attributes carry
`clipId`, `clipTimeOffset`, `tint`, `damageFlash`, `dissolve`.

- Cost: `verts × frames × 2 textures`. A 1,800-vert enemy with 9 clips at 24fps
  totalling 120 frames = 1800 × 120 = 216k texels ≈ a 512×512 RGBA-half texture
  per enemy type. Nine enemy types ≈ 18MB. Acceptable — and it's why the horde
  triangle budget (§17) is low by design.
- Limitation: no runtime blending between clips. Mitigation: sample two clips and
  lerp in the shader for a 150ms crossfade (2× texture fetches, only during
  transitions — gate it behind a per-instance `blendWeight > 0`).
- Limitation: no attachments/IK. Horde units get no weapons that need hand
  tracking, which is a *design* constraint we accept (they're clawing corpses).

**Tier B — elites, bosses, Deputies, the hero (≤10 on screen): real
`SkinnedMesh`** with `AnimationMixer`, additive aim offsets and IK where needed.
This is where all the animation craft goes, and it's affordable because there are
so few of them.

**Tier C — distant crowds (>45m): billboard imposters.** Optional; only if the
Boot Hill kit's long sightlines actually hurt. Measure first.

Also: `three.BatchedMesh` for static props (headstones, barrels, crates) —
multiple geometries, one draw call, with per-instance frustum culling. That plus
per-chunk material merging is how a whole site renders in ~40 draw calls.

### 14.4 Lighting & shadows

- **Baked ambient occlusion + a lightmap per chunk**, baked in Blender (Cycles)
  into the chunk's atlas. Static geometry gets its beauty for free.
- **One directional light** (moon) with cascaded shadow maps for the hero, elites
  and large props. Horde units **do not cast real shadows** — they get a soft
  blob-shadow decal projected on the ground. Nobody notices; it saves the entire
  shadow-pass cost of 200 skinned draws.
- **Lanterns and hex sources** as a capped set of dynamic point lights (8 high /
  4 med), assigned per-object by proximity so three doesn't compile a
  many-light shader variant for everything.
- **Shader compile hitching is the #1 stutter source in three.js.** Mitigation is
  mandatory: at load, instantiate one of *every* material/VFX variant off-screen
  and call `renderer.compileAsync()` (three 0.185 supports it) before the title
  screen finishes its dolly. Loading screens exist to hide this.

### 14.5 Post-processing & the look

`postprocessing` 6.39.4 (pmndrs, used standalone — no R3F needed), one composite
pass:

1. **Selective bloom** on emissives only (hex-cyan, lantern-orange, muzzle
   flashes). Threshold high, radius wide. This is what sells "gothic."
2. **AgX/filmic tonemap** + a subtle **split-tone** LUT (cool shadows, warm
   highlights) — the Buried palette in one node.
3. **God rays** as art-directed billboard shafts in the geometry, *not* volumetric
   raymarching. One tenth the cost, more control, and dust motes do the rest.
4. **Film grain + ordered dither** at low amplitude. Kills gradient banding in the
   dark mine interiors — a real problem at 8-bit output, and the fix is nearly
   free.
5. **Vignette** and a *very* restrained chromatic aberration at the edges.
6. **Hit feedback**: a radial red flash + 3-frame chromatic pulse on player damage.

Deliberately **not** doing: SSAO (baked instead), SSR, TAA (jitter fights the
crisp pixel look; use FXAA or MSAA on the main target), motion blur.

### 14.6 Juice checklist (M8 — this is where "good" becomes "great")

- **Hit stop**: 60–90ms freeze on heavy trap kills, sim-tick-accurate (scale the
  accumulator, not the sim step — never break determinism for feel).
- Screen shake: 3 tuned curves (light/med/heavy), trauma-based decay, capped and
  reduced-motion aware.
- Muzzle flash lighting the world for 2 frames; shell casings (pooled, physics
  optional); recoil as camera *and* animation offset.
- Damage numbers: pooled, world-space, arced, colour-coded by source family.
- Gore: pooled blood decals with a ring buffer; dissolve-to-ash shader on death
  (a `dissolve` per-instance attribute, driven by noise threshold — cheap and it
  removes corpses without a pop).
- Enemy hit reaction: 80ms white flash + a directional lean; stagger animation
  for heavies.
- **Trap satisfaction pass**: every trap needs a wind-up tell, an impact frame, a
  sound with real low end, and a cooldown tell. A trap that fires silently is a
  bug.

### 14.7 WebGL2 now, a second backend later

v1 ships **WebGL2 only** — one renderer, one set of shaders, one set of bugs. But
the door stays open at near-zero cost, because presentation is already isolated
from the sim (§12.2). The extra discipline is one thin seam:

```
render/
  backend/
    types.ts        ← the interface everything else codes against
    webgl2/         ← three.js WebGLRenderer implementation (v1)
    webgpu/         ← EMPTY. three's WebGPURenderer + TSL node materials
  scene/            ← backend-agnostic: what to draw, not how
  materials/
    defs/           ← material *descriptions* (uniforms, features, blend state)
    glsl/           ← GLSL implementations (v1)
    tsl/            ← EMPTY. node-graph implementations
```

The rules that keep the seam real:
1. **Nothing outside `render/backend/webgl2/` imports from `three/webgpu` or
   writes raw GLSL inline.** Materials are declared as data (`{ features: ['vat',
   'hatch', 'rim'], uniforms: {...} }`) and compiled by the backend.
2. `render/scene/` deals in draw *intents* — "this instanced batch, this
   material def, this transform buffer" — never in `WebGLProgram`s.
3. One `?renderer=` query flag selects the backend, so both can be live at once
   during a future migration and compared frame-by-frame on the same replay
   (determinism pays off again: identical input, two renderers, diff the frames).

Why not WebGPU now: three's WebGPU path needs materials rewritten in TSL, so
every shader would be authored twice for a v1 that has no shader library yet. The
honest sequencing is *build the look in GLSL, then port a finished look*. Two
things do want checking before committing v1 shaders, though — compute-shader
particle simulation and instanced-mesh limits are where WebGPU's win is largest,
so keep those two subsystems behind especially clean interfaces.

---

## 15. Navigation, collision & physics

### 15.1 Navmesh + flow fields (the core movement decision)

**Recast** via `recast-navigation` 0.43.1 bakes a navmesh from the assembled
site's collision geometry, in `nav.worker`, once per site (~50–200ms — hidden
behind the site transition).

Then the key call: **enemies do not run A\*.** For each active gate we bake a
**flow field** over the navmesh polygons (Dijkstra from the Rift, one pass,
storing the next-polygon and a direction vector per poly). Every travelling
enemy just samples the field for its current polygon — **O(1) per enemy per
tick**, no path storage, no repath storms, and 220 units cost less than 20 A\*
agents would.

- **Rebake triggers:** a trap or barricade changes traversability; a chunk's
  breakable geometry is destroyed; a new gate activates. Rebake is incremental
  (only affected tiles) and runs in the worker; enemies keep using the stale
  field for the 1–2 frames it takes. Nobody can see it.
- **A\* is reserved for the exceptions** that genuinely need a distinct route:
  Coyote Pack (path to the *least trapped* lane — costed A\* with trap density as
  edge weight), Bone Bride (blink target selection), Gravelung/Tumbleweed
  (pathing to a specific trap). That's ≤12 agents doing real queries, in the
  worker, with results consumed asynchronously.
- **Local avoidance** is *not* RVO (too expensive, and it looks too polite for a
  horde). Instead: spatial-hash **positional separation** — 2 relaxation
  iterations pushing overlapping cylinders apart, deterministic, ~0.4ms at 220
  units. Horde units *should* shove each other.
- **Off-navmesh movement:** fliers (Buzzard) use a simple 3D steer to the Rift
  with obstacle avoidance from the BVH; burrowers (Rattler) leave the navmesh
  entirely and reappear at a precomputed surface point.
- **The build-phase path preview** ("ghost paths") is the flow field rendered as
  animated dotted lines. It's free — the data already exists — and it is the
  single most player-respecting feature in the game.

### 15.2 Static collision

- Each chunk authors an explicit low-poly **collision mesh** (boxes and convex
  shapes, no triangle soup where avoidable).
- On site instantiation, merge all chunk collision into one `three-mesh-bvh`
  (0.9.14) BVH. Used for: hitscan rays, LOS checks, trap placement validation,
  capsule sweeps, decal projection.
- A **uniform grid** (4m cells) indexes traps, enemies and corpses for broadphase
  queries — cheaper and more predictable than a BVH for thousands of moving
  points.

### 15.3 Character movement

Hand-rolled and deterministic:

- Capsule (r=0.4, h=1.8) swept against the static BVH; 3 iterations of
  move-and-deflect; slope limit 45°, step offset 0.35m.
- Grounded test = short downward sweep with a small skin width. Ground-snap when
  grounded to avoid stair chatter.
- Separate horizontal/vertical resolution — the classic fix for "stuck on
  geometry seams."
- Why not Rapier's character controller? Because movement is the most
  feel-critical and most determinism-critical system in the game, and we want
  every constant in our own hands.

### 15.4 Rapier: cosmetic only

`@dimforge/rapier3d-compat` 0.19.3 (base64-inlined WASM — no loader config,
which is exactly why the `-compat` build exists) runs a **separate,
non-authoritative** world stepped after the sim, for things that can never affect
gameplay:

- Death ragdolls (pooled, ≤12 active, frozen and faded after 3s)
- Debris: barrel staves, chandelier shards, coffin lids, shell casings
- Swinging signs, hanging chains, cloth-ish rope (impulse-driven)

Gameplay never reads back from Rapier. Reasons: Rapier's JS build does not
guarantee cross-platform determinism, WASM stepping is a real cost we can *skip
entirely* on the low tier, and a solver in the authoritative loop makes replay
divergence nearly impossible to debug.

Consequence: the Mine Cart is **kinematic on a spline**, not a rigid body. It
looks identical and it can't ever get stuck.

---

## 16. Audio

Audio is 50% of perceived quality in a horde game and is usually the first thing
cut. Budget for it explicitly.

### Graph (raw Web Audio — a ~200-line wrapper, not a library)

```
sources ─► [voice gain] ─► [PannerNode (HRTF off, equalpower)] ─┐
                                                                ├─► bus: SFX ──┐
music stems ─► [stem gains] ─────────────────────────────────► bus: MUSIC ─┤
ui ──────────────────────────────────────────────────────────► bus: UI ────┼─► master
ambience ────────────────────────────────────────────────────► bus: AMB ───┘   [comp]
                                                                                 ▼
                                                                            destination
```

`howler` 2.2.4 is the easy option, but it doesn't give us bus-level compression,
convolution reverb per space, or the voice-stealing control a 220-enemy scene
needs. Hand-rolled is ~200 lines and worth it.

- **Voice pool of 32** with priority stealing (player > boss > trap > enemy >
  ambience) and distance culling at 40m. Without this, 40 simultaneous enemy
  footsteps will crush a mid-range laptop.
- **Sample variation**: 3–5 variants per impactful sound, ±5% pitch jitter, ±1.5dB
  gain jitter. Repetition is what makes browser games sound cheap.
- **Convolution reverb** per space type (mine / interior / open), crossfaded on
  the chunk the player occupies. One short IR each; costs almost nothing and
  transforms the mine.
- **Ducking**: sidechain the music bus off boss lines and the Bell.
- **Music as layered stems**: bed (harmonium drone), rhythm (bone-dry snare +
  boot stomps), melody (slide guitar / jaw harp), danger (choir). Wave intensity
  (a 0–1 director signal) crossfades layers in. Build phase = bed only. Act III
  = choir always audible. Phase 3 of the final boss = **silence**, which only
  works because everything else was loud.
- **Diegetic HUD**: the wave-start bell, the ledger stamp on a scored hand, the
  card snap, the revolver's cylinder click on reload.

### 16.4 AI-generated audio — the production pipeline

**Decision: we generate all audio ourselves with generative tools, then master it
properly.** This is a good fit for exactly this project: a solo dev needs ~180
unique sounds, ~15 music stems and a handful of voice lines, and a licensed
library gives you generic results while hand-recording gives you three great
sounds and no time left. Generative tools invert that — you get *specific* ("a
rusted iron bear trap snapping shut in a dry wooden barn, close-miked, no
reverb") in seconds.

The thing that separates usable AI audio from obviously-AI audio is **everything
after generation.** Raw output is the wrong length, has room reverb baked in,
inconsistent loudness, no loop points and no variation. So this section is 20%
tools and 80% pipeline.

#### Tool map

| Job | First choice | Alternates | Notes |
| --- | --- | --- | --- |
| **Music** | **Suno** (best song-level musicality and instrument control) | **Udio** (cleaner mixes, better stems), **ElevenLabs Music**, **Riffusion** | Cloud, paid. Commercial rights are a paid-tier feature on all of them — check current terms |
| **Music (open/local)** | **ACE-Step** (Apache-2.0 — the safest license in the space) | **Stable Audio Open**, **MusicGen** (weights are CC-BY-NC → **non-commercial only**) | Lower ceiling than Suno, total control, no per-generation cost, and license-clean |
| **SFX** | **ElevenLabs Sound Effects** (text→SFX; the best one-shot generator, and it will give you dry, short, isolated hits) | **Stable Audio Open** (local, fine-tunable), **AudioGen**, **Adobe Firefly audio** | This is where AI audio is *most* convincingly better than a library |
| **Voice** | **ElevenLabs** (voice design + TTS) | **Cartesia Sonic**, **Resemble**, **PlayHT**, **Fish Audio** | The Vigil barely speaks; bosses need presence, not range |
| **Stem separation** | **Demucs** (`htdemucs`, local, free) | LALAL.ai, Udio's stem export | The escape hatch when a generated track is perfect but mixed |
| **Repair / cleanup** | **iZotope RX** (de-reverb, de-noise, spectral repair) | Audacity + `noisereduce`, Adobe Enhance | De-reverb is the single most valuable tool here |
| **Mastering / matching** | **Matchering** (open source, reference-matched) | Landr, eMastered | Use it to force 600 heterogeneous files toward one tonal signature |
| **DAW (the actual work)** | **Reaper** ($60, scriptable, batch-converts, perfect for this) | Ableton, Audacity for quick edits | You need a DAW. There is no way around this. |

> **Zero-budget substitutions** (§17.0): the *first choice* column above assumes a
> budget. Free stack: **ElevenLabs free tier** for the ~30 priority SFX and voice
> lines, **Freesound** (CC0) for the ~570-file tail, **Suno free tier** plus local
> **MusicGen medium** / **Stable Audio Open** / **ACE-Step** for music, **Demucs**
> and **Matchering** locally, and **Waveform Free** or **LMMS** as the DAW instead
> of Reaper. The one place you'll genuinely feel it is music quality — that's the
> first thing to spend $10/mo on if money ever appears.

#### The pipeline

```
1  SPEC       write the cue sheet first (§16.5) — 180 named sounds with intent,
              length, and category. Never generate without a target.
2  GENERATE   5–10 candidates per cue, prompted for DRY/CLOSE/MONO/SHORT
3  CURATE     pick 1 hero + keep 2 as variant seeds; delete the rest immediately
              (an un-curated AI audio folder becomes unusable within a week)
4  REPAIR     de-reverb → high-pass (80–120Hz on most SFX) → de-noise →
              trim to the transient (0 samples of pre-roll; games need instant hits)
5  LAYER      comp 2–3 generations into one sound: transient (click/snap) +
              body (thud/metal) + tail (debris/ring). This is the step that makes
              it sound designed rather than generated.
6  VARIANT    export 3–5 variants per impactful sound (alternate takes, ±5%
              pitch, ±1.5dB) — the engine picks randomly at play time
7  NORMALIZE  to the category spec table below, not by ear
8  ENCODE     Opus/WebM + AAC fallback; commit to `art/audio/` sources and
              `game/public/assets/audio/` shipped
9  LEDGER     append prompt + model + seed + settings to `art/audio/prompts.jsonl`
```

#### Prompting rules that matter for games

- **Always ask for dry, close-miked, no reverb, no room.** We apply our own
  convolution reverb per space (§16 graph). Baked-in room sound fights it and
  instantly reveals the seams between assets.
- **Ask for mono** for anything positional. A stereo gunshot panned by a
  `PannerNode` sounds wrong.
- **Ask for short and isolated**: "single hit, 400ms, no music, no ambience, no
  tail." Generators love to give you a scene; you want an element.
- **Describe material and space, not emotion.** "Rusted iron on dry pine,
  close" beats "scary trap sound."
- **Name the era and mechanism.** "1880s single-action revolver hammer cocking,
  metallic ratchet, three clicks" gets you something with the right character
  because the model has heard those words together.
- **Generate the layers separately**, then comp. Asking for the whole sound at
  once gives you an average of a hundred sounds; asking for the snap, the meat
  and the debris separately gives you *your* sound.

#### Music: the stem problem, solved by generating layers

Our music system needs **4 independently faded stems per cue** (§16). Song
generators produce mixed tracks. Three options, in order of quality:

1. **Generate each layer as its own pass, locked to a fixed key and tempo per
   act** (the recommended path). Prompt each one as a solo performance — "solo
   harmonium drone, D dorian, 84 BPM, no other instruments, dry" — then align in
   Reaper. Bar-grid alignment does the rest, and because the layers were never
   mixed together they fade cleanly. Consistency comes from the *spec*, not from
   the model remembering anything.
2. **Generate a full track, then Demucs it** into 4 stems. Fast, and the musical
   result is usually better; separation artifacts (bleed, phasey cymbals) are
   real but often inaudible under gameplay.
3. **Use a generator's native stem export** where available. Best of both when
   it works; verify current capability at the time.

Fixed musical spec, so every layer stacks and every act's cues crossfade:

| Act | Key | Tempo | Bed | Rhythm | Melody | Danger |
| --- | --- | --- | --- | --- | --- | --- |
| I — Boot Hill | D dorian | 84 | Harmonium drone | Dry snare + boot stomps | Slide guitar | Low strings |
| II — Shaft Nine | C minor | 92 | Bowed metal / pump organ | Hammer-on-rail percussion | Jaw harp, banjo tremolo | Male choir (low) |
| III — Ninth Bell | B♭ minor | 100 | Church organ + bell drone | Timpani / footfalls | None (melody is the choir) | Full choir, cluster |

Also needed: title theme, Coffin/meta theme, camp theme, 3 boss themes, victory
sting, death sting. Death and victory stings must be in the act's key or they
clash with whatever is still fading out.

#### Loop points

Generative output does not loop. Fix it once, properly: find a bar-aligned region,
crossfade 1–2 bars at the seam, export the exact loop length, and record
`loopStart`/`loopEnd` in the audio manifest. `AudioBufferSourceNode` loops
sample-accurately on the decoded buffer, so a correct loop is seamless — but note
Opus carries encoder pre-skip/padding, so **always verify loops on the decoded
buffer, not on the file**, and store loop points in samples, not seconds.

#### Loudness spec (normalize to the table, never by ear)

| Category | True peak | Short-term target | Notes |
| --- | --- | --- | --- |
| Player weapons | −3 dBTP | −14 LUFS | The loudest thing in the game |
| Trap impacts | −3 | −15 | Needs real low end (60–120Hz) to feel heavy |
| Boss vocals / Bell | −3 | −16 | Ducks the music bus |
| Enemy vocals | −6 | −20 | 40 of these can play at once |
| Footsteps / cloth | −12 | −28 | |
| UI / cards / stamp | −6 | −18 | Crisp, dry, no tail |
| Music stems | −1 | −20 each | Four summing to ≈ −16 |
| Ambience | −12 | −30 | |

Run the whole library through **Matchering** against 2–3 reference sounds from a
game whose mix you admire. It's the cheapest way to make 600 files feel like one
sound designer made them.

#### Voice

The Vigil is laconic by design (§3), so this is a small job with high impact:
~20 hero grunts/breaths/reload mutters, ~12 lines per boss, ~30 UI/announcer
lines ("the bill is posted", "they're through", hand names). Design one voice per
character in ElevenLabs and **save the voice id** — regenerating a line six months
later with a different voice is the failure mode. Process boss voices with pitch
shift, formant shift and a long convolution tail so they don't sound like TTS;
the Choirmaster should be several stacked takes detuned a few cents apart, which
is both convincing and trivially easy.

Every spoken line gets a caption entry (§20) — the captions are written first,
then generated, so the text is the source of truth.

#### Reproducibility, licensing, and honesty about both

- **`art/audio/prompts.jsonl` is a first-class asset.** One line per generated
  file: `{ file, cue, model, version, prompt, seed, settings, date, license }`.
  This makes regeneration reproducible, makes style-matching a new sound to an old
  one possible, and — crucially — means that **if a tool's licensing changes, you
  can re-generate the affected assets on a different model instead of losing
  them.** It's the same instinct as the replay ledger in §13: keep the inputs, not
  just the outputs.
- **Commercial terms vary by tool and tier and are actively in flux** (the major
  music generators have been in litigation with rights-holders since 2024). For
  this project the exposure is minimal — a private, unlinked, non-commercial game
  — but two rules keep it that way: verify the current terms of any tool before
  using it, and prefer license-clean models (**ACE-Step**, Apache-2.0; **Stable
  Audio Open** under its community licence) for anything that might ever appear in
  a public trailer or case study. Note specifically that **MusicGen's weights are
  CC-BY-NC** — fine for a private game, not fine for a portfolio trailer.
- Keep a `CREDITS.md` listing every tool and model used. It costs nothing and it's
  the honest thing to do.

#### Deliverables and budget

| Deliverable | Count | Est. |
| --- | --- | --- |
| SFX cues (unique) | ~180 | with 3–5 variants each ≈ 600 files |
| Music stems | 3 acts × 4 + 8 standalone cues | ≈ 20 |
| Voice lines | ~90 | plus captions |
| Impulse responses (reverb) | 3 | mine / interior / open — generate or record |
| **Total shipped size** | | **≤ 14MB** (Opus: 64kbps mono SFX, 128kbps stereo music) |

Realistic effort: **~2 weeks** of focused work for the full library at quality,
front-loaded on the ~30 sounds the player hears constantly (revolver, boot,
footsteps, the four starter traps, hit markers, card snap, ledger stamp). Those
thirty are worth half the total time; the other 570 can be good-enough.

Formats: **Opus in WebM** primary, AAC/m4a fallback for Safari safety.

### 16.5 The cue sheet

Write this before generating anything. It lives at `art/audio/cues.csv` and is
the single source of truth for what exists, what's missing, and what's mixed:

```
id, category, description, length_ms, variants, loops, priority, status, prompt_ref
sfx.revolver.fire, weapon, "1880s single action revolver, dry crack, close", 900, 5, no, 1, done, p_0041
sfx.trap.jaws.snap, trap, "rusted iron bear trap snapping shut on bone, dry", 600, 4, no, 1, todo, -
mus.act1.bed,      music, "solo harmonium drone, D dorian, 84bpm, dry",     32000, 1, yes, 1, todo, -
```

Priority 1 = the ~30 constantly-heard sounds. Do those first, to final quality,
before generating a single wave-3 enemy vocalization.

---

## 17. Art direction & the AI-assisted pipeline

Art comes **after** the game is proven fun in grey-box (§21: M0–M3 first). This
section is the guidance you asked for: what AI is genuinely good at in 3D, what
it is genuinely bad at, which tools to use for which job, and — most
importantly — how to stop a pile of AI-generated assets from looking like a pile
of AI-generated assets.

### The one thing to understand before spending a dollar on any of these tools

> **AI is excellent at "a thing." It is terrible at "a system."**

A gravestone, a lantern, a wagon wheel, a coffin, a boss silhouette — AI will give
you those in minutes, at a quality that would take you a day each by hand. That's
transformative for this project: there are ~120 props in four kits.

But a **modular kit** is a system. Wall pieces must be exactly 4m wide, with edges
that align to 0.01mm, pivots at the min-corner, UVs sharing one trim sheet, and
seams that match across every combination. No generative tool does this, and
"fixing" a generated wall into a grid-true module takes longer than modelling it
from a cube. Same for anything that deforms: generated meshes are triangle soup
or loose quads with no edge loops at the elbows, so they crumple when skinned.

So the pipeline is a **division of labour**, not a replacement. And the cohesion
problem — the reason AI-assembled games look cheap — is solved *downstream*, in a
palette lock and a single shader (§17.9), not by praying for consistent
generations.

### 17.0 Working constraints: zero budget, zero Blender experience

Two hard constraints, both stated up front because they reshape this section more
than anything else in the document:

- **No money.** Every tool below is free. Where a paid tool was the first choice,
  the free substitute is named and its actual quality gap stated.
- **No Blender experience at all.**

The second one matters more than the first, and it needs an honest answer rather
than an encouraging one.

#### What's actually hard in Blender, and what isn't

Blender is not one skill, it's about six, and they differ by an order of magnitude
in how long they take:

| Skill | Realistic time to *useful* | Needed here? |
| --- | --- | --- |
| Navigation, import/export, material setup | 2 days | Yes — unavoidable |
| **Box modelling on a grid** (cubes, extrude, snap, mirror, array) | ~1 week of evenings | Yes, for the kit — **and it's the easiest thing in Blender** |
| UV unwrap + packing into an atlas | 3–4 days | Yes, for props |
| Baking (AO, lightmaps, normals) | 2–3 days | Yes — mostly button-pressing |
| **Rigging + weight painting** | **Weeks to months** | ❌ **Route around it** |
| **Sculpting / organic modelling** | **Months** | ❌ **Route around it** |

So: **~2 weeks of deliberate practice gets you the 20% of Blender this project
needs**, and the two skills that would take months are both avoidable. That's
lucky, and it's not an accident of the plan — it's because the hand-work this
architecture requires (grid-true modular pieces) happens to be the beginner-
friendly kind, while everything organic was already assigned to generation.

Learn in this order, and stop when you can do the thing: (1) box-model a 4m wall
module that snaps to the grid, (2) unwrap and pack it into a shared atlas, (3)
bake AO onto it, (4) export it as glTF and see it in the game. That's the whole
curriculum. Don't do a donut.

#### Routing around rigging entirely: Mixamo

**This is the single most important substitution in the re-planned pipeline.**
Adobe's **Mixamo** is free, takes a humanoid mesh in a rough T-pose, auto-rigs it
in the browser, and hands back both the rigged character *and* a large library of
royalty-free animations (walk, run, strafe, aim, fire, reload, hit reactions,
deaths, idles). It exists precisely to let people who cannot rig, ship rigged
characters.

That collapses three of the hardest line items at once:

- Hero rig: **Mixamo auto-rig** instead of Auto-Rig Pro + weight painting
- Hero animation (28 clips): **Mixamo library**, retimed and blended in code,
  with hand-keying reserved for the ~6 clips that carry personality (fan-fire,
  boot kick, the two deaths) — and even those can start as edited Mixamo clips
- All 8 humanoid enemies: same rig, same clips, **zero additional rigging**

The quality gap is real and worth naming: Mixamo's auto-weights are decent but
not hand-quality (shoulders and hips are where you'll see it), and its animations
are generic — a Mixamo walk looks like a Mixamo walk. Mitigations that cost no
skill: additive noise layers, per-enemy playback speed variation, aggressive
retiming, and heavy reliance on the *silhouette* (hat, coat, attachments) for
character. For a game viewed from 3.4m at 60fps with forty enemies on screen, this
is a very acceptable trade.

#### The two paths for environments

The kit is the one place that genuinely needs Blender. There's a second option
that needs none, and I'd start there:

| | **Path A — code-generated architecture** | **Path B — Blender modular kit** |
| --- | --- | --- |
| How | Wall/floor/stair/fence/pillar geometry generated in TypeScript as parameterized `BufferGeometry`, textured by triplanar world-space mapping onto CC0 materials | ~60 hand-modelled pieces on the 4m grid, shared trim sheets |
| Blender needed | **None** | ~2 weeks of learning + ~2.5 weeks of modelling |
| Cost | $0 | $0 |
| Visual ceiling | Medium-high *with a strong shader*. Hard limit on ornament, decay, and irregularity | High |
| Bonus | **The grey-box you must build for M0–M3 anyway becomes the shipping art.** And "the entire world is generated from code" is a genuinely strong case-study claim to a technical reader | Conventional, well-trodden |
| Risk | Reads as programmer-art if the shader and lighting aren't excellent | You have to actually learn Blender |

**Recommendation: start on Path A, and treat Path B as an optional upgrade you can
decide about in month three.** The reasoning is that you need grey-box geometry for
M0–M3 no matter what, so building it as *parameterized, art-directable* geometry
costs nothing extra and might turn out to be the final look. If it isn't good
enough by M4, the Blender learning curve is still only two weeks and nothing is
wasted — the chunk format (§11) doesn't care whether a chunk's geometry came from a
glTF file or a generator function.

Irregular organic things (rock, dead trees, terrain, cloth) don't code-generate
well; those come from CC0 packs or AI generation regardless of path.

#### The zero-cost stack

| Job | Free tool | Replaces | Gap |
| --- | --- | --- | --- |
| DCC / export / bakes | **Blender** | — | — |
| Auto quad-retopo | **Instant Meshes** (standalone, open source) or Blender's built-in **QuadriFlow Remesh** | Quad Remesher ($109) | Noticeably worse edge-flow control; fine for props, not for anything that deforms — which is fine, because props don't deform |
| Humanoid base mesh | **MakeHuman / MPFB2** (Blender addon), or a **CC0 rigged character** from Quaternius | Character Creator 4 ($200) | Lower fidelity, fewer body-type sliders. Adequate — the silhouette does the work |
| Rigging | **Mixamo** (free) or **AccuRIG** (free) | Auto-Rig Pro ($40) + months of skill | Auto-weights, not hand weights |
| Animation | **Mixamo library** (free, royalty-free) | Video mocap + Cascadeur | Generic motion; mitigated by retiming + silhouette |
| Mesh generation | **local TripoSR / Stable Fast 3D / Hunyuan3D-mini** (8GB-friendly) + **Meshy/Tripo free tiers** | Meshy/Tripo paid (~$20–40/mo) | Blockout-grade locally; free tiers are credit-limited and often carry non-commercial or attribution terms — **verify before using output in a public trailer** |
| Parametric props | **Sloyd free tier** | Sloyd paid | Credit-limited |
| Concept art + textures | **ComfyUI + SDXL / quantized Flux + depth-normal ControlNet**, **StableProjectorz** | Midjourney sub | **No gap. This is free and excellent on your 3070** |
| CC0 material/texture source | **ambientCG**, **Poly Haven** | Substance ($) | Genuinely production-grade, and CC0 |
| CC0 mesh/character packs | **Quaternius**, **Kenney** | — | Low-poly stylized; a *good* fit for the hatch shader |
| Height/normal from photo | **Materialize**, **ArmorLab** | Substance Sampler | Fine |
| DAW | **Waveform Free** (Tracktion) or **LMMS**; **Audacity** for quick edits | Reaper ($60) | Waveform Free is a real, unlimited-track DAW — the gap is workflow polish, not capability |
| SFX generation | **ElevenLabs free tier** (credit-capped, check terms) + **Freesound** CC0 + local **Stable Audio Open** | ElevenLabs paid | Fewer generations/month; Freesound fills the gap for the 570 non-critical sounds |
| Music | local **MusicGen medium** / **Stable Audio Open** / **ACE-Step**, or **Suno free tier** | Suno paid | Real quality gap here, and it's the most visible one. See the note below |
| Stems / mastering | **Demucs**, **Matchering** | LALAL / Landr | No gap |
| Photogrammetry | **RealityScan** on your phone | — | Free, and the best free source of authentic western surface material |

**Total cost: $0.** The two places you'll feel it: music quality (local models are
clearly behind Suno) and animation polish (Mixamo vs. hand-keyed). If money ever
appears, spend it in exactly that order — **$10/mo on a music generator first,
$109 on Quad Remesher second**, and nothing else is close.

#### What this costs the plan, honestly

You said you want highest quality. The engineering can genuinely be top-tier and
none of it is affected by these constraints. The art will land at
**"stylized, cohesive and deliberate"** rather than "AAA fidelity" — and that is a
perfectly good outcome, because the way stylized reads as *intentional* rather
than *limited* is exactly the palette-and-shader discipline in §17.9, which costs
discipline rather than money or skill. *Darkest Dungeon*, *Return of the Obra
Dinn*, *Hyper Light Drifter* and *Dome Keeper* all look expensive and none of them
are. What kills a project like this is heterogeneous assets under a
physically-accurate shader; what saves it is homogeneous assets under an
opinionated one.

**And the timing is generous: you don't have to decide any of this for eight
weeks.** M0–M3 needs grey-box only. Build the game, prove it's fun, then pick a
path with a real prototype in front of you.

### 17.1 The look

**The style is stylized and cartoony, in the Orcs Must Die sense** (§2) — chunky
exaggerated forms, bold flat colour, readable at a glance — carrying a **grim
western-gothic subject**. That combination is the whole art direction in one
sentence: *Orcs Must Die shapes, Buried lighting, no jokes.*

**Reference stack:** **Orcs Must Die 1 & 2** for form language, proportion and
colour separation; Buried's gaslit frontier for layout, lighting and value;
*Darkest Dungeon* for how far a limited palette + strong silhouette carries mood
without fidelity; *Dome Keeper* and *Hyper Light Drifter* for proof that a small
palette under an opinionated shader looks expensive.

**What "cartoony" means concretely** — these are the rules, not the vibe:

- **Chunky over fine.** Nothing thinner than **4 cm** on any asset. Teeth are fat
  wedges, not needles; bolts are oversized; a chain has three big links, not
  twenty small ones.
- **Exaggerate function.** The part that *does the thing* is 1.5–2× its realistic
  size. A bear trap's teeth and a keg's hoops are what identify it at 64px, so
  they get the volume.
- **Taper everything.** A pure axis-aligned box reads as untextured programmer
  art; the same box with a 10–15% taper or bulge reads as hand-made. This costs
  zero polygons and is the single cheapest quality lever in Path A.
- **One flat colour per part, high value separation** between adjacent parts. No
  gradient maps, no material blending. If two neighbouring parts have the same
  value, merge them or re-colour one.
- **No detail under 3 cm.** It's invisible at gameplay distance and becomes noise.
  See the derivation in `art-recipes/prompts/character-model.md` §2.
- **Silhouette is the asset.** Every prop must be identifiable as a black shape at
  64px, from the camera's actual above-and-behind angle.

**Rules:**

- **Value before hue.** Every asset must read in greyscale: dark ground, mid
  architecture, light sky/fog. Enemies are *always* darker than their background
  or rim-lit against it — never mid-on-mid.
- **Silhouette first.** Design the silhouette from 20m away before any detail. If
  an enemy isn't identifiable as a black shape at 64px, redesign it.
- **Palette discipline** — a fixed 14-swatch palette. Every texture in the game is
  mechanically pulled toward it at import time (§17.9), which is what makes
  heterogeneous AI output cohere:

| Role | Hex | Use |
| --- | --- | --- |
| Void | `#0b0a0c` | Deepest shadow, mine darkness |
| Ash | `#232227` | Base shadow |
| Grave | `#3b3a3d` | Stone, iron |
| Dust | `#6e6559` | Ground, dry earth |
| Bone | `#c9bfa8` | Skeletal, cloth highlight |
| Sun-bleach | `#e6dfc8` | Highlight, sky |
| Timber | `#5a4433` | Wood mid |
| Timber-dark | `#33261c` | Wood shadow |
| Rust | `#8a4a2b` | Corroded iron, Company |
| Oxblood | `#7a1f24` | Blood, damage feedback |
| Lamp | `#ffab5e` | Fire, lanterns, safe/yours |
| Ember | `#ff5d3b` | Explosions (shares the portfolio's `--accent`) |
| Hex | `#4ff0e0` | Choir / arcane / "physical won't work" |
| Bell | `#9be3ff` | Rift light, cold magic accents |

Note `#ff5d3b` is deliberately the portfolio's own `--accent` — the launcher page
and the game share one warm pop, which quietly ties the hidden route to the site.

- **Shading model — "banded toon + outline."** Not full PBR, and no longer the
  cross-hatch/woodcut model this section used to specify — hatching is an
  *etching* language, which fights cartoony forms. Instead: a custom
  `ShaderMaterial` (or `MeshStandardMaterial` with `onBeforeCompile` injections)
  doing albedo × baked-AO × lightmap, with
  - a **hard 3-band ramp** on the direct light term — a crisp terminator, not a
    soft falloff. The crispness *is* the style; a smooth ramp lands back in
    stylized-realism;
  - a **weak Fresnel rim** in the lamp colour, pulled halfway to white. This was
    specified as *strong*, and as the thing that separates a body from its
    background — that turned out to be wrong, and the reason is worth keeping:
    **a Fresnel rim needs smooth normals, and our geometry is flat-shaded on
    purpose.** Every facet carries its own face normal (`models/build.ts`), so
    `dot(N, V)` is constant across a whole facet and the rim lands as a uniform
    wash on any facet angled away rather than as a line on the silhouette. At the
    originally-specified strength it read as orange blotches on the Ironjaw. The
    separation job therefore belongs to the **outline**, which is the mechanism
    that suits faceted art; what's left of the rim only stops the darkest facets
    going fully flat. Found by looking at the shelf scene (§17.9);
  - a **saturated ambient bounce** from below in the ground colour, so shadows
    read as coloured rather than grey;
  - an **inverted-hull outline pass** on characters, enemies and traps (not on
    architecture — it gets noisy on a modular kit). Cheap: one extra draw per
    instanced pool, back-faces only, scaled along normals, depth-tested.
    This is the single most recognisably "cartoony" thing in the renderer and it
    costs almost nothing.

  Three payoffs, and the third is why this shader was always the right call:
  (a) it suits the OMD reference directly, (b) it's far cheaper than full PBR,
  and (c) — critically for a pipeline mixing CC0, AI-generated and
  code-generated sources — **it forgives inconsistent source material**, because
  the shader, not the texture, is doing the styling (§17.9, R23).

- **Palette under a cartoony shader.** The 14 swatches and their *roles* (below)
  do not change — they're already shipped in `game/src/render/palette.ts` and the
  `ember` swatch is deliberately shared with the portfolio's `--accent`. What
  changes is how punch is produced: from **value separation between adjacent
  parts** plus the hard ramp and saturated bounce, not from desaturated
  photo-realistic material response. If mid-tones still read flat in the M4 look
  dev, lift saturation on `dust`, `timber` and `grave` *then*, with pixels on
  screen — not now, and never on `hex`/`bell`, which carry mechanical meaning.
- **Wetness/grime**: a single global grime mask sampled in world space adds
  variation across repeated kit pieces for free. Repetition is modular building's
  only real weakness; this is the cheap fix.

### 17.2 Division of labour: what AI makes, what you make

| Asset class | Count | Method | Why |
| --- | --- | --- | --- |
| **Modular kit** (walls, floors, stairs, boardwalk, roofs, fences) | ~60 pieces | **Path A: code-generated `BufferGeometry`** (default) · Path B: Blender box modelling on the 4m grid (§17.0) | Grid-true, seam-matching, shared UVs — a *system*, not a thing. AI cannot do this at all; the only question is whether the system lives in TypeScript or in .blend files |
| Kit trim sheets & atlases | 8 textures | **AI-generated, hand-composited** (ComfyUI/Flux or Substance Sampler) → de-lit → palette-locked | Texture generation is where AI is unambiguously good |
| **Props** (headstones, barrels, coffins, crates, lanterns, wagons, ore carts, church pews, water tower parts) | ~120 | **AI generate → retopo → re-UV into atlas** | The biggest single time win in the project |
| Parametric props (barrels, crates, fences, pipes, planks) | ~25 | **Sloyd** (parametric, clean quads, real-time) | Faster and cleaner than generation for regular shapes |
| **Traps** (hero assets — players stare at these) | 23 | AI base mesh → **heavy hand cleanup** + hand-authored moving parts | They must animate, telegraph and read at a glance. Spend the time |
| **Humanoid enemies** | 8 of 14 | **ONE shared base mesh + ONE rig**, varied by sculpt/blendshape + texture (§17.5) | The professional trick, and better than AI here |
| Non-humanoid enemies (Buzzard, Wisp, Tumbleweed, Rattler, Chain Gang links, Colossus) | 6 | AI generate → retopo → hand rig | Bespoke silhouettes where AI's weirdness is an asset |
| **Bosses** | 3 | AI concept + AI base → hand retopo/sculpt → hand rig | Hero assets. The Choirmaster is mostly shader work anyway |
| **Hero** | 1 | **MakeHuman/MPFB2 or CC0 base → Mixamo auto-rig** → silhouette pass (hat, coat, attachments) in Blender | Deforms constantly, on screen 100% of the time, full body visible. Rigging is routed around entirely (§17.0) |
| Hero animations | 28 clips | **Mixamo library**, retimed and blended in code; hand-key only the ~6 personality clips | Removes the single hardest skill from the critical path |
| Enemy animations | 9 shared | **Same Mixamo clips on the same rig**, varied by playback speed, additive noise and attachment weight | 126 bespoke clips was never realistic; 9 shared clips is |
| VFX flipbooks (smoke, fire, sparks, dissolve) | ~20 | AI-generated frames + hand-authored noise textures | |
| **Concept art** | every asset | **AI (Flux/Midjourney/SDXL)** — orthographic sheets | See §17.9: this is where cohesion is actually won |

### 17.3 The AI 3D tool map

The space moves monthly; treat versions as approximate and re-check before
subscribing. Ordered by how much you'd use them on this project.

#### Mesh generation (image→3D and text→3D)

| Tool | Best at | Topology | Cost shape | Verdict |
| --- | --- | --- | --- | --- |
| **Meshy** | The all-rounder: image/text→3D, PBR texturing, quad remesh, auto-rig, batch API | Quad-ish after its remesh pass; usable | Subscription + credits | **Start here.** Best single tool if you buy one |
| **Tripo AI** | Fastest, often the cleanest raw geometry; good re-texturing | Good quads | Free tier + paid credits | Generate the same prop in both free tiers and keep the better one |
| **Rodin / Hyper3D** | Highest detail fidelity — hero props, boss silhouettes, ornate ironwork | Dense; needs retopo | Credits | Use selectively for the 20 assets that matter most |
| **Hunyuan3D** (Tencent) | **Open weights, runs locally.** Separate shape + texture models | Dense; needs retopo | **Free** (needs ~12–24GB VRAM) | If you have the GPU, this is unlimited generation at zero marginal cost. Best value in the space |
| **TRELLIS** (Microsoft) | Open, excellent single-image geometry, structured latents | Dense | Free, local | Great local companion to Hunyuan3D |
| **Sloyd** | **Parametric**, not generative: real-time sliders, genuinely game-ready topology | Clean quads | Subscription | The right tool for barrels/crates/fences/pipes. Underrated |
| **Kaedim** | Human-in-the-loop cleanup; output is actually game-ready | Good | Expensive per asset | The "pay money to skip retopo" option. Worth it for bosses if budget allows |
| **Luma Genie / Masterpiece X / Alpha3D / CSM** | Text→3D quick concepting | Varies | Free tiers | Useful for blockout and silhouette exploration |

> **Zero-budget note:** Meshy, Tripo, Rodin, Sloyd and Kaedim all have **free
> tiers** — credit-limited, and often carrying non-commercial or attribution terms,
> so verify before any output reaches a public trailer. Ration those credits for
> the ~30 props that matter and use the local models below for volume. Free-stack
> summary: Appendix A.2.

> **What fits in 8GB VRAM** (your machine — RTX 3070, 32GB system RAM):
> **light models yes, heavy models no.** `TripoSR` and `Stable Fast 3D` run
> comfortably and return a blockout in seconds. `Hunyuan3D-mini` fits. But the
> full **Hunyuan3D + PBR texture pass** and **TRELLIS** are built for 16–24GB —
> they'll only run with sequential CPU offload, and a 20-minute offloaded
> generation is worse than a 60-second cloud call. 32GB of system RAM makes
> offload *possible*; it doesn't make it *worth it*.
> **So: mesh generation goes to the cloud (Meshy/Tripo), and the 3070 earns its
> keep on 2D instead** — see §17.12.

**Photogrammetry deserves a mention**, because you live in a country full of the
actual reference material: **RealityScan** (Epic, free, phone) or **Polycam** turn
a real weathered fence post, a rusted hinge, a real headstone, or a pile of dry
timber into a mesh and — more valuably — into *photo textures with real detail*.
For a western game, a weekend of shooting old wood and iron will out-perform any
generator for surface material. Gaussian splats are not game-ready geometry, so
use the photogrammetry (mesh) mode, and mostly harvest **textures**, not meshes.

#### Texturing

| Tool | Use |
| --- | --- |
| **StableProjectorz** (free) | Projection-paint a mesh with SD/Flux from multiple views. Best free option, and the most *controllable* — you choose the camera angles, which is exactly what stylized game texturing needs |
| **ComfyUI + Flux/SDXL + ControlNet** (depth/normal/canny) | Full control: render the mesh's depth+normal, generate a texture conditioned on it, project, repeat. Slowest, best results, free if local |
| **Substance 3D Sampler** | Photo→PBR material; the fastest path from your photogrammetry photos to a tiling trim sheet |
| **Substance 3D Painter** | Still the best hand-texturing tool if you have it. Smart materials do enormous work on iron/wood |
| **Meshy / Tripo re-texture** | Prompt a *new* texture onto an existing mesh — the cheapest way to make 3 enemy variants from 1 mesh |
| **ArmorLab** (free), **Materialize** (free), **Dream Textures** (Blender addon) | Free fallbacks for height/normal/roughness extraction |

#### Retopology, LODs and cleanup

| Tool | Use |
| --- | --- |
| **Instant Meshes** (free, open source) or Blender's built-in **QuadriFlow Remesh** | ✅ **The zero-cost pick.** Turns generated triangle soup into usable quads. Worse edge-flow control than the paid option, which doesn't matter for props (they never deform) |
| **Quad Remesher** (Exoside, Blender addon, ~$109 perpetual) | The paid upgrade, and the best single thing to buy *if* a budget ever appears. One-click, with edge-loop guidance |
| Blender **Remesh (voxel) → Quad Remesher → Decimate** | The standard rescue chain for a dense generated mesh |
| **gltf-transform `simplify`** (already in §17.8) | Automated LOD1/LOD2 generation. No manual LOD work at all |
| **InstaLOD / Simplygon** | Overkill for this scale, but they exist |
| **RetopoFlow** (Blender) | Manual retopo for the ~6 assets that deserve hand topology |

#### Characters, rigging and animation

| Tool | Use | Cost |
| --- | --- | --- |
| **MakeHuman / MPFB2** (Blender addon) | ✅ **The zero-cost pick** for the shared humanoid base. Lower fidelity and fewer sliders than CC4; adequate, because the silhouette and attachments carry the identity (§17.5) | Free |
| **Character Creator 4** (Reallusion) | The paid alternative: game-ready topology, UVs, LODs and a correct rig from sliders. **Out of scope at $0** | ~$200 |
| **AccuRIG** (Reallusion) | **Free.** Auto-rig any humanoid mesh, and it's genuinely good | Free |
| **Mixamo** | Free auto-rig + a large animation library. Retarget to your shared rig for enemy locomotion/attacks | Free |
| **Auto-Rig Pro** (Blender) | The paid rigging option. **Not needed** — Mixamo auto-rigs for free and skips weight painting entirely (§17.0) | ~$40 |
| **Rokoko Video / Move.ai / Plask / DeepMotion** | **Video → mocap from a phone.** Record yourself walking, drawing, fanning a revolver, kicking | Free tiers exist |
| **Cascadeur** | Physics-assisted keyframe animation with AI auto-posing. The best value animation tool in existence for game action; ballistic trajectories are automatic, which matters for a game full of launched bodies | Free tier / ~$25/mo |
| **Blender + Rigify** | Free fallback for everything above | Free |

### 17.4 The mesh pipeline, step by step

For a prop (repeat ~120 times; target **15–25 minutes each** once the pipeline is
warm):

```
1  CONCEPT     Flux/Midjourney: orthographic front view, neutral grey background,
               flat lighting, with the SAME style suffix as every other concept
               (§17.9). Iterate in 2D — it costs seconds, not minutes.
2  GENERATE    image→3D in Meshy AND Tripo (and Hunyuan3D locally if available).
               Keep the best of 3. Never text→3D when you have an image — text
               loses your art direction.
3  RETOPO      Instant Meshes (or Blender QuadriFlow) to the target tri budget
               (§17.7). Check the silhouette
               survived; fix by hand if a key edge got rounded off.
4  NORMALIZE   scale to metres, pivot to spec, transforms applied, +Y up on export,
               custom normals, name to convention. Scripted where possible.
5  UV          re-UV into the kit's prop atlas at the correct texel density.
               This is the step AI does NOT do for you and it is the main
               remaining manual cost.
6  TEXTURE     bake the generated texture down into the atlas slot, OR re-texture
               via StableProjectorz/ComfyUI for style control.
7  DE-LIGHT    remove baked shadow/AO from the albedo (§17.9). Non-negotiable.
8  PALETTE     `palette_lock.mjs` pulls the albedo toward the 14 swatches.
9  BAKE        AO + curvature into the atlas; LODs auto-generated at build.
10 VERIFY      `budget_check.mjs` fails the build on any violation (§17.10)
```

For a **humanoid enemy**, skip 1–5 entirely: it's a variant of the shared base
(§17.5). For a **kit piece**, skip 1–3: it's box-modelled by hand.

### 17.5 Characters: one humanoid base, eight enemies

You're right that the theming needs humanoids — the Tuned *are* Hollow Creek's
own dead, and that only lands if they read as people. So invest in exactly one
good humanoid, and vary it:

```
        ┌──────────────────────────────────┐
        │  SK_HumanoidBase                 │
        │  ~1,800 tris · 22 bones          │
        │  ONE UV layout · ONE rig         │
        └──────┬───────────────────────────┘
               │ shape keys / sculpt layers (proportions)
               │ + texture variants (skin, cloth, damage)
               │ + attachment slots (head, hands, back)
               ▼
  Dustkin   Ironjaw   Hollow Preacher   Deadeye   Bone Bride
  Chain Gang link   Company Miner   Gravelung(partial)
```

Why this beats generating eight enemies:

- **One rig** → one skinning job, one animation set, one VAT bake path, one set of
  bugs. 126 animation clips become 9 clips plus per-enemy overrides.
- **One UV layout** → a texture variant is a 20-minute job, not a day.
- **Consistent scale and silhouette language** for free, which is pillar #2
  (legible chaos) — enemies must be distinguishable *by design*, not accidentally
  different sizes because two generations disagreed.
- **Attachment slots** carry the identity: Ironjaw is the base + an iron helmet +
  plate + heavier proportions; the Preacher is the base + a wide hat + a coat +
  a book; the Deadeye is the base + a rifle + a duster. This is exactly how real
  games do horde variety.

**Where the base comes from, at zero cost and zero rigging skill:**

1. **MakeHuman / MPFB2** (free Blender addon) generates the body at the right
   proportions and topology, or start from a **CC0 rigged humanoid** (Quaternius)
   if the low-poly look suits — it does suit the hatch shader.
2. **Mixamo** auto-rigs it and supplies the 9-clip animation set (§17.0). The rig
   and the clips are both free and royalty-free.
3. Identity comes from **attachment meshes** — hat, coat, helmet, plate, rifle,
   book — which are static props (AI-generated or CC0), *not* character work. This
   is the key insight: eight distinct enemies from one rig, where all the
   distinguishing work is prop modelling rather than character modelling.
4. Use AI for **concepting** the eight silhouettes in 2D first, and for baked
   **normal-map detail** if you want it later. Neither is required for v1.

The base mesh and rig are the only two assets that are genuinely
irreplaceable — everything else is a variant on them.

The non-humanoids (Buzzard, Lamplight Wisp, Tumbleweed Hex, Rattler, Marrow
Colossus, Stagecoach Hearse) are where generation shines — weird, one-off,
non-deforming or simply-deforming shapes. The Wisp is largely a shader.

### 17.6 Rigging & animation

- **Hero:** **Mixamo auto-rig** (free, no weight painting). Its standard skeleton
  is ~65 bones; strip unused fingers on export to stay near 60. Additive
  aim-offset layers on spine/neck are added *in code* as a runtime bone rotation,
  not as authored animation — which is both cheaper and more responsive than
  blending authored aim poses, and needs no rigging skill.
- **Shared humanoid rig:** the same Mixamo skeleton, no IK, no facial. VAT bakes
  the bones away at export (§14.3) so the horde costs nothing at runtime.
- **Turn-in-place** and foot planting: skip authored versions. Use a code-driven
  yaw-rate threshold with a Mixamo turn clip, and accept some foot sliding — at
  3.4m boom distance with 40 enemies on screen, nobody is looking at the hero's
  feet. Revisit only if it reads badly in the M4 look-dev pass.
- **Bosses:** 40–70 bones. The Choirmaster's cloth is a vertex shader, not
  simulation.
- Animate at **24fps** (deliberate, stylized, and it halves VAT texture cost),
  root motion **removed** (locomotion is code-driven).

**Animation sourcing at zero cost:** take everything from the **Mixamo library**
first (it has western/pistol/rifle sets, hit reactions, deaths and full locomotion),
retime it to our speeds, and blend in code. Then improve only the ~6 clips that
carry personality — fan-fire, boot kick, the two deaths, the title pose — by
editing the Mixamo clip rather than authoring from scratch (moving existing keys is
a beginner-level Blender task; authoring a clip from nothing is not).

**Later, free upgrade path:** phone-video mocap (**Rokoko Video** / **Plask** free
tiers) gives you *your own* body language, which is more distinctive than any
library, and **Cascadeur's free tier** does physics-assisted cleanup. Worth trying
at M8 if the animation is the weakest thing left — but it is explicitly not on the
critical path.

**Clip list — hero (~28 clips):** idle, idle_alert, walk (4-way), run (4-way),
sprint, jump_start/loop/land, slide, aim_idle, fire, fan_fire, reload_start/
loop/end, boot_kick, melee_1/2, cast_a/b/c, hurt_l/r, death_1/2, place_trap,
revive, victory, title_pose.

**Clip list — humanoid enemy (9 clips, shared across all 8):** spawn_emerge,
walk, run, attack_1, attack_2, stagger, death_1, death_2, idle. Nine clips ×
~13 frames average = the 120-frame VAT budget in §14.3. Per-enemy character comes
from **playback speed, additive noise layers and attachment weight**, not from
new clips.

**Clip list — boss:** 10–16 each, including two telegraph animations (the tell is
the fight — hand-key these).

### 17.7 Standards & budgets (enforced by the build, not by willpower)

| Rule | Value |
| --- | --- |
| Scale | **1 Blender unit = 1 metre**. Hero is 1.8m |
| Up axis | Blender Z-up; export with **+Y up** (glTF convention) |
| Grid | Kit pieces snap to **0.25m**; chunk footprint 16m; wall modules 4m × 4m (half 2m) |
| Pivot | Kit pieces: min-corner at origin. Props: base centre. Characters: between the feet |
| Transforms | Applied before export (no non-uniform scale, no negative scale) |
| Normals | Custom split normals or weighted-normal modifier |
| Texel density | **128 px/m** hero props · **64 px/m** environment · **256 px/m** weapons |
| UVs | UV0 = atlas/trim, UV1 = lightmap (env only), no overlaps on UV1 |
| Materials | One material per atlas. **Max 3 materials per chunk** |
| Naming | `SM_` static, `SK_` skinned, `AN_` clip, `T_` texture, `COL_` collision, `LOD1/2` suffixes |

| Class | Tris | Notes |
| --- | --- | --- |
| Hero | 24k | plus 3k weapon |
| Boss | 20k | |
| Elite (Hearse, Colossus) | 8k | real SkinnedMesh |
| Shared humanoid base | **1,800** | VAT cost is `verts × frames` — doubly load-bearing |
| Horde LOD1 / LOD2 | 600 / 250 | auto-generated |
| Prop | 200–1,500 | generated props land here after retopo |
| Chunk (visual) | 3k–8k | ≤180k per assembled site |
| Trap | 400–1,200 | generous — players stare at these |

**Texturing standards:** trim sheets and atlases, not per-asset textures. One
2048² trim sheet per kit + one 2048² prop atlas per kit → 8 base textures for the
whole game. Channel packing: `T_*_alb` (RGB albedo + A mask), `T_*_nrm` (RG normal
+ B roughness + A AO) — two textures per material, always. Baked lightmap+AO per
chunk into a shared 1024² atlas (Cycles, 32 samples, denoised). Compression via
`gltf-transform`: **UASTC** for normals, **ETC1S** for albedo/masks.

> **The atlas requirement is the main friction with AI generation**, because every
> generator hands you a per-asset UV layout and its own texture. Re-UVing into a
> shared atlas is the one manual step that doesn't go away. Budget 5–10 minutes per
> prop for it, and batch 10 props into one atlas session rather than doing them
> one at a time.

### 17.8 The build pipeline (one command)

```
art/                                # sources (see §18.4 for where this lives)
  kits/{boothill,creek,shaft,reliquary}.blend
  chars/{hero,humanoid_base,dustkin,...}.blend
  traps/*.blend   props/*.blend   textures/   audio/
  gen/            # raw AI output, pre-cleanup — never shipped, always kept
  prompts.jsonl   # every generation: tool, prompt, seed, date (see §17.9)
pipeline/
  export.py         # headless bpy: batch-export collections → glTF + ChunkDefs
  normalize.py      # scale/pivot/orientation/naming fixes on imported AI meshes
  palette_lock.mjs  # pull every albedo toward the 14-swatch palette
  delight.mjs       # strip baked AO/shadow from generated albedos
  bake_vat.mjs      # sample skinned clips → VAT position/normal textures
  optimize.mjs      # gltf-transform: dedup/weld/join/simplify/meshopt/ktx2
  budget_check.mjs  # FAILS THE BUILD on any §17.7 violation
  manifest.mjs      # content-hashed manifest.json
game/public/assets/                 # optimized, shipped output
```

```bash
npm run art              # full rebuild
npm run art:one hero     # single-asset loop — TARGET: under 15 seconds
npm run art:import <file># normalize + retopo-check a fresh AI generation
```

`export.py` iterates collections named `CHUNK_*` and writes a `ChunkDef` (§11) by
reading custom properties off empties: connector types on edge empties,
`SurfaceSlot` volumes from cubes in a `SLOTS_` collection, `envSlots` from curves.
**Level design happens in Blender** and the game reads it directly — no separate
editor to build.

### 17.9 Cohesion: how to stop it looking like AI art

This is the section that decides whether the game looks like a portfolio piece or
a marketplace haul. Five mechanisms, in order of impact:

1. **Win cohesion in 2D, not 3D.** Generate *every* concept image with one fixed
   style suffix and one fixed lighting description, in batches, and iterate there
   — a 2D miss costs 20 seconds, a 3D miss costs 25 minutes. Then always use
   **image→3D**, never text→3D. The mesh inherits the concept's art direction.
   Keep the style suffix in `art/prompts.jsonl` and never change it mid-project.
2. **Palette-lock every albedo at import.** `palette_lock.mjs` maps each texel
   toward its nearest of the 14 swatches with a tunable strength (start at 0.6).
   Mechanical, unglamorous, and it is *the* reason a generated headstone and a
   hand-modelled wall will look like they belong to the same game.
3. **De-light everything.** Generated textures almost always bake in shadow and
   AO. Our lighting model does that work (§14.4), so baked shading fights it and
   looks flat and dirty. `delight.mjs` (or Substance Sampler's de-lighter) strips
   it. Also prompt for "flat albedo, no shadows, even lighting" up front.
4. **One shader for everything.** The hatch/ramp material (§17.1) re-styles every
   asset through the same lighting response. Two meshes from different generators
   under one shader read as one world; the same two under a physically-accurate
   shader read as two asset packs.
5. **One detail-frequency budget.** Reject any asset with meaningfully more surface
   detail than the kit around it — a photoreal ornate generated lantern next to a
   flat-shaded wall looks *worse* than a simple lantern. When in doubt, simplify
   the generated asset.

Plus the boring one: **look at all your assets together, often.** Keep a "shelf"
scene in the game (a debug room with every prop and enemy in a line, under game
lighting) and open it every session. Cohesion problems are invisible per-asset and
obvious in a row.

### 17.10 AI asset acceptance checklist

No generated asset enters `art/` until it passes. `budget_check.mjs` automates the
starred items.

- [ ] ★ Scale correct in metres (hero-relative sanity check: is the barrel
      knee-height?)
- [ ] ★ Pivot per spec, transforms applied, no negative/non-uniform scale
- [ ] ★ +Y up on export, faces the right way (−Z forward for characters)
- [ ] ★ Triangle count within the §17.7 budget
- [ ] Quad-dominant after retopo; edge loops present anywhere it will deform
- [ ] ★ Single material, UV0 packed into the correct kit atlas at correct texel
      density, no UV1 overlaps
- [ ] Albedo de-lit — no baked shadows, no baked AO, no baked highlights
- [ ] ★ Palette-locked
- [ ] Silhouette readable as a black shape at 64px
- [ ] Detail frequency consistent with the kit
- [ ] ★ Naming convention followed
- [ ] Collision mesh authored (`COL_*`) if it's a world object
- [ ] Prompt + tool + seed recorded in `prompts.jsonl`

### 17.11 Loading strategy

| Bundle | Contents | Budget (compressed) |
| --- | --- | --- |
| Boot | JS engine + UI + title scene | ≤ 1.8MB |
| Core | hero, revolver, HUD, 6 starter traps, VFX atlas, music bed | ≤ 6MB |
| Act I | Boot Hill + Creek kits, 6 enemy types | ≤ 9MB |
| Act II | Shaft kit, 5 enemy types, boss | ≤ 8MB |
| Act III | Reliquary kit, 3 enemy types, final boss | ≤ 8MB |
| Audio | all | ≤ 14MB |
| **Total** | | **≤ 45MB**, with **≤ 8MB before first playable** |

Act bundles stream during camp/offer screens (there's always ≥15s of menu before
a new kit is needed). A visible, honest progress bar; never a black screen.

### 17.12 Cost and effort

**Tooling, one-off: $0.** The whole stack is free — see §17.0 for the substitutions
and their honest quality gaps, and Appendix A.2 for the install list. For
reference, the paid tools this replaces would have run ≈$410 one-off (Quad
Remesher, Character Creator 4, Auto-Rig Pro, Reaper) plus ≈$50–90/month in
subscriptions.

#### The local/cloud split for this machine (RTX 3070 · 8GB VRAM · 32GB RAM · Ryzen 5 5600X)

8GB draws the line in a clean place: **pay for generating *things*, generate
*surfaces* locally.** Surfaces are the high-volume iteration loop — hundreds of
concept images and texture passes, where a free local generation you can run
fifty times beats a metered one you run five times. Things (meshes, music, voice)
are low-volume and quality-critical, and the cloud models are meaningfully better.

| Job | Where | Why |
| --- | --- | --- |
| **Concept art / orthographic sheets** | ✅ **Local** | SDXL runs native in 8GB; Flux via GGUF Q4/Q5, fp8, or an INT4 build fits comfortably. This is the single highest-volume loop in the art pipeline (§17.9) and it becomes **free and unlimited** |
| **Texture generation & projection painting** | ✅ **Local** | StableProjectorz and ComfyUI + SDXL + ControlNet (depth/normal) are exactly 8GB-class workloads. All 8 atlases and every trim sheet, free |
| **Mesh generation** | ☁️ **Cloud** (Meshy + Tripo) | The 8GB-capable local models are blockout-grade; the good ones need 16–24GB. ~120 props × a couple of credits is cheap next to your time |
| **Quick blockouts / silhouette exploration** | ✅ **Local** (TripoSR, SF3D) | Seconds per generation, good enough to test a silhouette before spending a cloud credit |
| **Lightmap + AO baking** | ✅ **Local** | Blender Cycles with OptiX on a 3070 is genuinely fast. The whole §17.7 bake strategy is free |
| **glTF optimize / KTX2 encode** | ✅ **Local** | CPU-bound; 6c/12t is fine |
| **Mesh generation** (quality tier) | ☁️ **Free tiers**, credit-limited | Meshy/Tripo free tiers, rationed to the ~30 props that matter most; local models cover the rest |
| **Music, SFX, voice** | ☁️ **Free tiers** + ✅ local | Not a VRAM decision — the paid cloud models are simply better, so ration free-tier credits to the ~30 priority sounds (§16.5) and fill the tail with **Freesound** CC0 and local `Stable Audio Open` / `MusicGen medium`. `ACE-Step` stays the **licence-clean** option for public trailer music (§22 R17) |
| **Stem separation (Demucs), mastering (Matchering)** | ✅ **Local** | Light / CPU |

**Total cost: $0** (§17.0). If money ever appears, spend it in this order and stop:
**a music generator (~$10/mo)** → **Quad Remesher (~$109 once)** → everything else
is optional.

**One-time setup worth doing before M4:** ComfyUI + an SDXL checkpoint + a
quantized Flux + depth/normal ControlNets + StableProjectorz, plus Instant Meshes
and a Mixamo account. Half a day, all free, and it removes the marginal cost from
the parts of the pipeline you'll touch most.

**Effort, re-estimated for the zero-cost / no-rigging plan:**

| Work | Fully hand-authored | Planned (§17.0 stack) |
| --- | --- | --- |
| **Learning Blender** (the necessary 20%) | — | **2 wk, one-off** |
| 4 kits (~60 pieces) | 3 wk | **1.5 wk** — Path A, code-generated, and it doubles as the grey-box you need for M0–M3 anyway |
| ~120 props | 4 wk | 1 wk |
| 8 trim sheets / atlases | 1.5 wk | **0.5 wk** — ambientCG CC0 + local generation |
| 23 traps | 2 wk | 1.5 wk |
| Hero + rig | 1.5 wk | **0.5 wk** — MakeHuman + Mixamo |
| Humanoid base + 8 variants | 2.5 wk | **0.75 wk** — variants are prop attachments, not characters |
| 6 non-humanoid enemies | 1.5 wk | 0.75 wk |
| 3 bosses | 2 wk | 1.25 wk |
| Hero animation (28 clips) | 2 wk | **0.5 wk** — Mixamo library, retimed |
| Enemy animation | 1.5 wk | **0.25 wk** |
| Cohesion / polish pass | 1 wk | **1.5 wk** — *more*, because the sources are more heterogeneous than ever |
| **Total** | **~22.5 wk** | **≈ 12.5 wk** (10.5 art + 2 learning) |

The headline isn't that it's faster — it's that it's **achievable without skills you
don't have and money you don't want to spend.** Two rows tell the real story: the
cohesion pass gets *longer* (mixing CC0, AI-generated and code-generated sources is
the hardest possible input for a unified look, which is exactly why §17.9 is
non-negotiable), and rigging/animation nearly vanish (7 weeks → 1.25) because
Mixamo removes the skill wall rather than the work.

---

## 18. Hosting, the launcher & the API

### 18.1 Build integration

```jsonc
// portfolio/package.json
"scripts": {
  "build":      "CI=false react-app-rewired build && npm run build:game",
  "build:game": "npm --prefix game ci && npm --prefix game run build",
  "dev:game":   "npm --prefix game run dev"          // Vite dev server :3040, HMR
}
```

The game's Vite config sets `base: '/hymn/'` and
`build.outDir: '../build/hymn'`, so it lands *after* CRA has already cleaned
and written `build/`. Order matters — reversing it deletes the game.

```jsonc
// portfolio/vercel.json — two edits
"rewrites": [
  { "source": "/hymn", "destination": "/hymn/index.html" },   // must come first
  { "source": "/((?!api/|hymn|.*\\.).*)", "destination": "/index.html" }
],
"headers": [
  { "source": "/hymn/assets/(.*)",
    "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
]
```

Two distinct paths, no collision:

- **`/gallows-hymn`** — a React route in the portfolio: the themed **launcher**
  (`src/Pages/GallowsHymn/`, CSS namespaced `.gh-*` per the project convention).
- **`/hymn/`** — the static Vite app, its own document, full-page, pointer-lock
  friendly.

The launcher navigates to `/hymn/` on click (a real navigation, not an iframe —
own document, own memory, and a clean `window.performance` profile for the game).

### 18.2 Hidden, not locked — the launcher

**Decision: no password, no gate.** The route is *unlinked and unindexed*, in the
spirit of `/dashboard` but without the lock screen. Reasons: you want to hand the
link to friends with zero friction, the leaderboard is explicitly for **all
players** (§18.3), and there is nothing private here to protect — it's a game, not
a ledger. A passphrase would only cost you players.

So the `/gallows-hymn` route is a **launcher**, not a gate, and it should be a
portfolio-quality set piece rather than a barrier: black screen, one swinging
lantern, a weathered wooden sign that reads `BONE ORCHARD · NO TRESPASSING`, the
title `GALLOWS HYMN` fading in over it, and a single branded iron-plate button —
**RING THE BELL**. Below it, in mono: last run's tally, current ante, and the top
three on the board. That's the five-second test for this route.

Two things the launcher still does:

1. **Capability check before you commit a 45MB download.** Probe WebGL2, required
   extensions, and `detect-gpu`; if the browser can't run it, say so kindly here
   rather than after the loading bar. Mobile gets the "desktop only" card (§20).
2. **Dev-tool unlock via the existing IP allowlist.** The `/dashboard` mechanism
   is genuinely useful, just repointed: `/api/game/access` returns
   `{ dev: true }` when the caller's IP is on `GAME_DEV_IPS`, which enables the
   tweakpane overlay, free camera and wave-skip (§19.2) **without** a `?dev=1` URL
   anyone could guess. Access is open; *debug* is allowlisted.

Discoverability hygiene:
- `robots.txt`: `Disallow: /gallows-hymn` **and** `Disallow: /hymn`
- `<meta name="robots" content="noindex,nofollow">` on both pages
- Unlinked from all public nav, the sitemap, and the command palette
- Surfaced as a tile inside `/dashboard` (already private) so you can reach it
  without typing the URL

**Stated honestly:** obscurity is the only access control here, and that's the
intent. If you ever *do* want it locked, Vercel Edge Middleware can check a signed
cookie on `/hymn/*` — but verify middleware's availability and billing on the
Hobby plan first, and note that it would break "send a friend the link."

### 18.3 The API — one function, minding the cap

`BUDGETTER.md` records the constraint: **Vercel Hobby caps a deployment at 12
serverless functions, counting files.** Current count is **5**
(`dashboard-access`, `contact`, `guestbook`, `reckoning`, `budget/[action]`).
So the game gets **exactly one file**, following the Budgetter dispatcher
pattern:

```
api/game/[action].js              ← 1 function, 6/12 total
api/_lib/game-auth.js             ← underscore dirs aren't functions
api/_lib/game-db.js
api/_lib/handlers/game-*.js       ← access | profile | run | leaderboard | replay
```

Tables (Neon, prefixed `gh_`, same instance as the guestbook and Budgetter):

```
gh_meta          key -> value                    (schema_version)
gh_profiles      player_key UNIQUE, display_name, ash, unlocks jsonb,
                 settings jsonb, created_at, seen_at
gh_runs          profile_id, seed, archetype, ante, curses jsonb,
                 depth, waves_cleared, tally, ash_earned, outcome,
                 duration_ms, build_hash, created_at
gh_replays       run_id UNIQUE, commands bytea, state_hashes bytea
gh_leaderboard   (materialized view over gh_runs: best tally per profile per ante)
```

`player_key` is a client-generated UUID in `localStorage` — **no accounts, no
email, no PII.** On first run the game asks for a display name (3–16 chars,
profanity-filtered, not unique) and that's the entire identity system. Cloud sync
exists so progress survives a browser wipe and so the board has something to rank.

**Local-first storage:** IndexedDB holds the in-progress run (crash/refresh
resume — essential for 40-minute runs), `localStorage` holds settings and the
`player_key`. The server is a mirror, not the source of truth, and the game is
fully playable offline with the API down.

#### The leaderboard (global, all players)

Since the route is open (§18.2), the board is genuinely global rather than a
private list — it just won't be busy, which is fine and actually helps: a board
with 30 real entries is more motivating than one with 30,000.

- **Boards:** *Top Tally* per ante tier, *Deepest Run*, *Fastest Full Clear*, and
  a rolling *This Week*. Four small boards beat one big one — more places to be
  first.
- **Every entry links its replay**, viewable in-game as a ghost. That turns the
  board from a number into content, and it's free because §13 exists.
- **Display:** rank, name, archetype icon, ante, tally, depth, date. Your own row
  is always pinned and highlighted even if it's rank 412.

**Integrity, honestly:** a client-authoritative score in an open browser game is
spoofable, full stop. Since anyone can now reach the endpoint, the mitigations
matter a bit more than they would behind a password:

| Layer | Measure |
| --- | --- |
| Rate limiting | Per-IP: 20 submissions/hour, 200/day (a simple `gh_ratelimit` table keyed by IP hash + hour bucket — no Redis needed at this scale) |
| Payload caps | Reject bodies over 512KB; replays are tens of KB |
| Build pinning | `build_hash` must match a currently-deployed build; stale-client scores are accepted but flagged, forged hashes rejected |
| Plausibility | Server bounds-checks tally vs. waves cleared vs. duration vs. ante using the same curve constants the client uses. Impossible tuples are rejected outright |
| Replay required | No replay, no board entry. A spoofer must forge a *consistent* command log, not a number |
| Lazy verification | Top-10 entries can be re-simulated locally in the dev build (seed + commands → assert the tally). Verified entries get a mark |
| Soft-delete | You can remove an entry; nothing is ever hard-deleted, so griefing is reversible |

That's the right amount of effort: enough that casual tampering fails, not so much
that a solo dev builds an anti-cheat system for a game with 30 players. The
replay infrastructure that makes it work was already justified in §13.

### 18.4 Where the built assets live (and why this needs deciding early)

**Vercel's build cannot run Blender.** The `npm run art` pipeline is a local,
GPU-and-Blender-dependent step, so `game/public/assets/` cannot be a build
artifact the way JS is — it has to exist *before* deploy. Three options, and the
first is the recommendation:

| Option | Verdict |
| --- | --- |
| **Object storage + content-hashed manifest** (Cloudflare R2 or Vercel Blob), fetched at runtime | ✅ **Recommended.** ~45MB never touches the repo; immutable caching; re-exports don't bloat git history; R2 has no egress fee. The manifest already exists (§17.8) and already carries hashes, so this is a base-URL change and an upload step in `npm run art` |
| Commit optimized assets to the repo | Workable but the repo grows by tens of MB per re-export pass, forever, and every clone pays for it. Acceptable only if you want a single deployable unit |
| Git LFS | ⚠️ **Avoid.** Vercel does not reliably fetch LFS objects during its clone, which means pointer files ship instead of assets — a confusing, hard-to-debug failure. Also GitHub's free LFS bandwidth is 1GB/month, and Vercel clones on *every* deploy |

**Source art** (`.blend`, PSDs, raw AI generations in `art/gen/`) stays **out of
this repo entirely** — it's hundreds of MB of binaries with no business in a
portfolio repo. Put it in a cloud-synced folder (OneDrive/Dropbox/Backblaze) or a
separate private repo, keep `art/prompts.jsonl` and `art/audio/cues.csv` **in**
the portfolio repo (they're small, text, and reviewable), and add `art/` to
`.gitignore` with a `README` pointing at where the real thing lives.

That answers the LFS question from the other direction: don't version the
binaries, version the *recipes*.

---

## 19. Testing, tooling & debug

### 19.1 Tests

| Layer | Tool | What |
| --- | --- | --- |
| Sim determinism | `node --test` | Seed + command log → assert final state hash. The single most valuable test in the project. |
| Golden replays | `node --test` | Committed replay fixtures of real sessions; any balance/logic change that alters outcome shows up as a diff you must consciously accept |
| Procgen | `node --test` | 5,000 seeds/act: every §11 guarantee, plus chunk-usage distribution |
| Content validation | `node --test` | Every `TrapDef`/`EnemyDef`/`RelicDef` parses, references resolve, no orphan assets, costs sane |
| Combo scoring | `node --test` | Table-driven: a kill sequence → expected hand + multiplier |
| Perf regression | `node --test` | Headless 1,000-tick sim with 200 entities; fail if ms/tick > budget. Runs in CI. |
| Asset budgets | `budget_check.mjs` | Part of `npm run art` |
| Smoke | **`puppeteer-core`** (already a devDependency) | Boot the built app, wait for first frame, assert no console errors, capture a screenshot |

The sim being pure and three.js-free is precisely what makes 80% of this testable
in plain Node with no browser and no mocks. That's the payoff for the §12.2 rule.

### 19.2 Debug overlay

Two ways in, because the route itself is open (§18.2): `?dev=1` in local dev
builds, or an IP on `GAME_DEV_IPS` in production (the repurposed `/dashboard`
allowlist). The panel's code is behind a dynamic import so it never enters the
production bundle for ordinary players.

**tweakpane** 4.0.5 panel + **stats-gl** 4.2.3:

- Live tuning bound to `balance.json` (with a "copy diff to clipboard" button so
  tuning sessions produce committable diffs rather than lost knowledge)
- Free camera; time scale 0–4×; single-tick step
- Spawn any enemy at the cursor; grant scrap/salt/Vigil; skip wave; reroll site
- Overlays: navmesh, flow field arrows, spatial-hash grid, trap radii & cooldowns,
  enemy state labels, AI think-budget heat, hitboxes, BVH
- Perf: per-system ms breakdown (a fixed-array profiler, not `performance.mark`),
  draw calls, triangles, GPU timer (`EXT_disjoint_timer_query_webgl2`), pool
  high-water marks, allocation-rate warning
- **A machine-scaled budget line.** The HUD reads a `PERF_SCALE` constant (0.3 on
  the dev 3070, 1.0 on a median machine) and colours the GPU readout against
  `10ms × PERF_SCALE` ≈ **3ms**. Without this the profiler is actively
  misleading on fast hardware — everything looks green until someone else opens
  the game (§22 R20)
- Replay scrubber: load a replay, jump to tick, watch the desync point
- **Attract mode**: play a recorded replay with a cinematic camera. Doubles as
  idle-timeout footage on the title screen and as the portfolio case study's hero
  video, captured at 4K/60 by running the replay with a fixed timestep and
  `MediaRecorder`. Deterministic replay makes this basically free — a genuinely
  good reason to have built it.

### 19.3 CI

Extend the existing pattern (`npm run test:api` already uses node's runner):

```
npm run test:sim     # determinism, procgen, combo, content, perf
npm run test:api     # existing + new game handlers
npm run build        # portfolio + game, with budget_check
npm run test:smoke   # puppeteer boot check on the build output
```

---

## 20. Accessibility & settings

The portfolio's philosophy doc says *inclusive by default*, and a game is where
that gets tested hardest.

- **Reduced motion** (`prefers-reduced-motion` respected, plus an in-game toggle):
  screen shake off, hit-stop reduced, camera sway off, no chromatic pulse, dust
  density down. Never disables gameplay-critical motion.
- **Colourblind modes**: deuteranopia/protanopia/tritanopia LUTs. Critical because
  the cyan/orange contract in §3 *is* mechanical information — so also add a
  **shape** cue (Choir units get a distinct halo ring, not just a colour).
- **Photosensitivity**: cap flash frequency, a "reduce flashes" toggle that damps
  muzzle/explosion brightness spikes.
- **Full remapping** for keyboard, mouse and gamepad; separate look sensitivity
  per input; invert axes; toggle vs. hold for aim/sprint/crouch.
- **Gamepad**: full support via the Gamepad API (it's a third-person shooter —
  a controller is the natural fit) with aim assist (light magnetism, 6° cone) as
  an option.
- **Subtitles/captions** for boss lines and important audio cues (`[bell tolls]`,
  `[wings overhead]`) — the audio carries mechanical telegraphs, so captions are
  a fairness feature, not a nicety.
- **Difficulty as accessibility**: a "Boot Hill" assist set (Vigil ×2, damage
  taken −40%, slower spawns) available at any time, no achievement penalty, no
  shaming copy. Ante ladder exists for the other direction.
- **FOV slider** (65–100), motion-sickness options (head-bob off, FOV-kick off).
- **Pointer lock**: never grab the cursor without an explicit click; always
  release on Escape; show an unmistakable "click to resume" overlay.
- **Mobile**: explicitly **not supported** in v1 (touch controls for a
  third-person trap shooter is its own project). Detect and show a polite
  "desktop only" card rather than a broken 12fps experience.

---

## 21. Milestones

Estimates assume solo, part-time, and are honest rather than optimistic. The
ordering reflects the two decisions that shape the schedule: **prove the game is
fun in grey-box before any art exists**, and **art is the critical path once it
starts** — so it runs in parallel with engineering from M4 onward rather than
sequentially.

| # | Milestone | Est. | Exit criteria (binary, testable) |
| --- | --- | --- | --- |
| **M0** | **Spike / vertical proof** | 1 wk | `/gallows-hymn` launcher → `/hymn/` loads; grey-box room; capsule controller with coyote time; full-body third-person camera; hitscan revolver; one primitive enemy walking a flow field; one bear trap that kills it. 60fps. **You can kill something with a trap.** |
| **M0** | ✅ **DONE** (2026-08-06) | — | See §21.1 for what shipped and what changed on contact with reality |
| **M1** | **Engine core** | 2 wk | Fixed-step loop + interpolation; bitECS world + 16 systems scaffolded; command queue; replay record/playback; state hashing; pools; spatial hash; event ring. **A 60s recorded session replays to an identical state hash.** |
| **M2** | **Content frameworks** | 2 wk | `TrapDef`/`EnemyDef`/`RelicDef` loaders; **trap placement across all four surface families** (§7.1: oriented slots, camera-ray targeting, cone/column area tests, projected reach preview) + upgrade/sell; damage/status pipeline; wave director with constraints incl. the surface census; economy; combo/poker system with HUD. **Exit widened: 3 traps × 3 enemies × 5 waves in JSON, and one of the three traps is wall-mounted** — floor-only placement would leave the Marshal and Preacher unable to use their exclusive traps |
| **M3** | **Procgen + nav** | 1.5 wk | Graph generator + validator; geometry instantiation; recast bake + flow fields in `nav.worker`; ghost path preview. **5,000-seed test green; 20 seeds play distinctly.** |
| **M4** | **Art pipeline spike + look dev** | 2 wk | The pipeline, proven end-to-end on a *tiny* amount of content: **one Creek room built as code-generated geometry (Path A)**; one AI-generated prop taken through generate → retopo → atlas → de-light → palette-lock → ship; one **Mixamo-rigged** humanoid walking with a library clip; `export.py` emitting `ChunkDef`s; VAT baker; `optimize.mjs`; `budget_check`; hatch shader + palette + post stack. **Exits: (a) one room at final visual quality, (b) `npm run art:one` under 15 seconds, (c) the Path A vs Path B call made with real pixels on screen (§23.2).** Deliberately *not* a content push |
| **M5** | **Roguelite meta** | 1.5 wk | Offers with the anti-frustration rule; relics; curses; camp nodes; Ash + Coffin menu; ante ladder; IndexedDB resume; `api/game/[action].js` + Neon tables + sync + leaderboard. **A full 3-act run is completable end to end with grey-box art.** |
| **M6** | **Content build-out** (engineering) | 4 wk | 23 traps, 14 enemies + variants, 3 bosses, 4 archetypes, ~30 relics, ~50 chunks — all *implemented and balanced*, consuming art as it lands. Playable and tuned before it's pretty |
| **M6-art** | **Art production** (parallel) | **~12.5 wk** | Per §17.12, and *including* ~2 weeks of scoped Blender learning (§17.0): 4 kits, ~120 props, 8 humanoid variants as attachment sets on one Mixamo-rigged base, 6 non-humanoids, 3 bosses, 8 atlases, and a **1.5-week cohesion pass** that is not optional. **The real critical path — runs alongside M6–M9** |
| **M7** | **Audio production** | 2 wk | The §16.4 pipeline: cue sheet, ~180 SFX with variants, 20 music stems, ~90 voice lines, 3 IRs, mastered to the loudness table. Front-load the 30 constantly-heard sounds |
| **M8** | **Feel, juice & polish** | 2 wk | §14.6 checklist complete; audio graph wired with reverb/ducking/voice-stealing; HUD/menus final; hero animation polish; trap satisfaction pass. **A blind playtester says "that felt good" unprompted.** |
| **M9** | **Perf, compat & a11y** | 1.5 wk | Tiering + DRS; shader warm-up; memory ceiling verified; gamepad; full remapping; colourblind/reduced-motion/captions; Chrome/Firefox/Safari + Windows/macOS pass at target framerate on an integrated GPU |
| **M10** | **Ship** | 1 wk | Launcher polish; title + attract mode; leaderboard live; telemetry; 4K/60 trailer captured from a replay |
| **M11** | **Case study** (post-ship) | 1 wk | A public `/work/gallows-hymn` write-up. The game stays hidden; the *write-up* is the portfolio artifact. Written after ship, but **capture screenshots, GIFs and replays throughout** — that costs nothing during development and is impossible to reconstruct afterwards |

**Honest totals.** Engineering ≈ **15.5 weeks**. Art ≈ **12.5 weeks** (10.5 of
production plus ~2 of scoped Blender learning). Audio ≈ **2 weeks**. Run strictly in sequence that's ~29 weeks; overlapped as above (art
starting at M4 and running through M9) the calendar lands at **≈ 20–24 weeks
part-time.** Art is the critical path from M4 onward, so the schedule is really
"how many art hours per week can you sustain?" — which is why §17 is built around
making each asset cheap rather than around making fewer of them.

**M0–M3 (6.5 weeks) is the risk-retiring sequence.** After M3 you know whether
the game is fun, in grey-box, before a dollar of tooling or an hour of art. If it
isn't fun there, more content won't save it — and you'll have spent six weeks, not
six months, learning that.

**If time gets tight, cut in this order:** Act III and the Reliquary kit (ship a
2-act run) → Guardians → two of three bosses → the Undertaker and Prospector
archetypes. Do **not** cut the combo system, the ghost path preview, the audio
pass, or the juice pass — those are load-bearing for the quality claim, and
they're cheap relative to content.

### 21.1 M0 — as built

**Exit criterion met: you can wound a Dustkin with the revolver and let Jaws of
Perdition finish it, at 60fps, on a code-generated site.**

| Layer | What exists |
| --- | --- |
| Sub-app | `game/` — own `package.json`, React 19.2, three 0.185, Vite 8.2, TypeScript 7. The portfolio's dependency tree is untouched |
| Sim | Fixed 60Hz deterministic step; 11 systems in the §12.4 order; SoA pools with free-lists; command queue; seeded `pure-rand` streams (combat/director/loot); FNV-1a state hash; own LUT `sin`/`cos` |
| Level | Path A: code-generated kit (`wallRun`/`block`/`pillar`/`steps`) → collision boxes → Dijkstra flow field, one bake |
| Render | Hand-written box mesher (baked face shading in vertex colours, bottom faces skipped, one draw call for the site); full-body spring-arm camera per §7; `InstancedMesh` enemies from day one; pooled sparks; `compileAsync` shader warm-up |
| UI | React 19 HUD outside the loop — Vigil bar, scrap, ammo cylinder, the Bill, build-mode banner, title card |
| Tests | 11 headless sim tests green (determinism, replay-from-log, flow-field reachability, §11 level guarantees, trap mechanics, leak/Vigil, build phase) + a puppeteer browser smoke test |
| Measured | 22 draw calls · 4.4k triangles · 207KB gzipped JS |

**Five things that changed on contact with reality** — recorded because the
reasoning matters more than the diff:

1. **The §7 "8° camera down-angle" was incoherent as specified.** A fixed downward
   tilt contradicts a centred crosshair; you cannot have both. Resolved by giving
   the *player's* starting pitch the −0.14rad instead, so the camera looks exactly
   along (yaw, pitch) and "shots go where the crosshair is" stays literally true.
   The camera pose is therefore computed in `sim/aim.ts`, not in render — the
   hitscan ray needs the camera origin, and the sim can't trust a value from
   outside itself.
2. **Dustkin HP is 45, not a placeholder.** Two revolver rounds (68) drop one
   outright; Jaws' 25 does not. That's what keeps the trap's verb *hold* rather
   than *damage*, and it's what makes "wound it, let the trap finish it" the
   satisfying line — the M0 exit criterion is a tuning consequence, not an accident.
3. **The first level layout silently broke everything.** The player's high-ground
   platform overlapped the Rift, the Rift cell is the flow field's only source, and
   a blocked source makes every cell unreachable — 0 placeable cells, no pathing,
   no game. Caught by the level-guarantee tests within a minute of writing them.
   *Lesson for M3: the procgen validator must assert the Rift cell is unblocked
   before anything else.*
4. **Enemy facing lives in render, not the sim.** It needs `atan2`, which is
   implementation-defined across JS engines (§13 rule 5), and facing has zero
   gameplay effect. Keeping it out of the sim keeps it out of the state hash.
5. **The perf HUD colours against ~3ms, not 16.6ms** (§22 R20), and the browser
   smoke test asserts the *catch-up ceiling* rather than a frame rate — headless
   Chrome renders through SwiftShader at ~3fps, so its fps is meaningless while
   `ticks ≤ frames × MAX_CATCHUP_STEPS` is a real invariant worth locking down.

**Known M0 gaps, deliberately left for later:** no enemy attacks (Dustkin only
leaks — the roster and utility AI are M2); no audio at all (M7); flat black sky with
a hard horizon (M4 look dev); no combo/poker system (M2); no post-processing (M4);
separation is O(n²) pending the M1 spatial hash; `game/src/net/` is empty by design.

### 21.2 M0.5 — endless rounds, the hotbar, and real synergies

A follow-on increment that changed the game's spine: **the score is the highest
round**, money arrives at round end, and traps interact through elements and
statuses rather than through tuning coincidence.

| Added | Detail |
| --- | --- |
| Round loop | Endless rounds with the §4 curve; elite every 5th; round-clear payout; Vigil partially restored; the round you die on is the score |
| Element/status system | 5 elements, 6 statuses, all resolved in the single damage writer. Amplifiers stack multiplicatively (asserted: `10 × 3 × 1.5 × 1.25 = 56.25`) |
| Traps that change traps | Fire lights overlapping Tar, swapping the pool's whole effect list for `litEffects` — a burning lake instead of a slow |
| Five starting traps | Jaws (hold), Tar (soak/slow, **no damage**), Vent (fire, ignites ground), Plate (launch), Sigil (**+50%, no damage**). No pure damage dealer in the set |
| Launch physics | Enemies gained vertical velocity, gravity, grounded state and fall damage, because "throw them into your other traps" has to be literal |
| Hotbar | Bottom-centre, always visible; `1`–`5` arm + enter build mode, wheel cycles, `Q` holsters, LMB sets, RMB sells. Live costs including surcharge; synergy line on the armed slot; element-coloured reach ring on the ghost |
| Tests | 27 headless sim tests (from 11), covering every synergy, the round loop, payouts, the purse and the hotbar |
| Capture harness | `scripts/capture-game.mjs` takes pointer lock, arms slots, places traps and screenshots — the seed of the §19.2 attract mode |

**Four things worth recording:**

1. **A 2.5s periodic vent is not a defence.** Bodies walked through between pulses.
   The fix wasn't a shorter cooldown — it was making fire light the *tar*, which is
   both a better mechanic and the thing the synergy text already promised. Design
   bugs are often missing mechanics, not wrong numbers.
2. **One 1.5m Tar Seep does not seal a 3.1m corridor.** A body walks down the
   uncovered edge. This is correct — coverage is the player's problem — but it
   means a test asserting "no leaks" has to build a defence that actually covers
   the lane. The `buildKillBox()` helper exists to make that explicit.
3. **`npm ci` in the build script broke the build on Windows.** It deletes
   `node_modules` wholesale, which fails whenever a native addon is held open
   (Vite 8 ships a rolldown `.node` binary). Switched to `npm install`. And the
   near-miss is the real lesson: CRA cleans `build/` *first*, so a failed game
   build leaves a deployable-but-dead `/hymn/`. The `&&` chain does fail the
   deploy — but my verification pipeline's `grep` masked the exit code and almost
   let me report a green build that wasn't.
4. **The HUD publishes only when it changes.** A per-frame `setState` would spend
   the entire §14.1 React budget on its own; a cheap signature string means React
   idles on most frames.

### 21.3 M0.6 — the fight

M0.5 made the traps interesting; the player was still a spectator with a gun who
could not die. This increment makes the fight a fight.

| Added | Detail |
| --- | --- |
| **The Boot** (§7) | 1.5s cooldown kick: launches the body nearest the crosshair in a 2.3m cone, 15 damage, and stamps 3s of *boot credit* — a trap finishing what you kicked scores **×2**. The verb that makes the shooter and the tower defence one system |
| **Enemies as data** | `sim/enemies.ts`, mirroring the trap catalog. Every system now reads `enemyDef(e.defId[i])`; an archetype is a row, not a branch |
| **Ironjaw** | Invalidates **chip damage**: hits under a 20 threshold clang off, so burn ticks and lit ground do nothing forever. Answer: the revolver, Jaws, the Plate — or amplifiers pushing a small hit over the line, which is a real discovery |
| **Buzzard** | Invalidates **the ground**. Cruises at 4.6m, ignores the flow field, the walls, the chokepoint and every trap in the catalog. Answer: the revolver. The enemy that finally gives the gun a job |
| **Melee** | Telegraphed swings with a windup, so a hit is a decision you lost rather than a tax. Player HP, i-frames, death, and full heal on round clear — melee is a round-scoped threat |
| **Poker hands** (§5) | The rolling 4s window, nine hands from Pair (×1.2) to Dead Man's Hand (×6.0), banked as Tally when the window lapses. Per-kill multipliers: trap ×1.5, gun ×1.3, booted-then-trapped ×2.0, airborne ×1.75 |
| **HUD** | Blood bar, Tally, the hand as a row of cards with its provisional name and multiplier, a ledger stamp when it banks, and the Boot's cooldown meter |
| **Tests** | **43** (from 27): the Boot's connect/whiff/cooldown, armour clang and amplified break-through, a flier surviving a full kill-box, debut caps, melee lethality and i-frames, and every poker hand |

**Four things worth recording:**

1. **The tests told me melee worked by failing.** "Clear a round with no traps and
   no shooting" broke the moment enemies could hit back, because a player parked in
   the lane now dies. That failure *is* the feature; the fix was a `parkPlayer()`
   helper that says so out loud.
2. **Armour is checked after amplifiers, deliberately.** It makes burn ticks
   useless against plate forever (correct — fire shouldn't melt armour) while
   making "mark it and your small hits start landing" a discoverable synergy. Order
   of operations *is* the design here, which is why it's a doc comment and a test.
3. **One line of code is the Buzzard's entire argument.** `if (e.grounded[i] === 0)
   continue;` in the trap aura loop. Every trap in the catalog is a ground trap, so
   flight invalidates all of them at once — no per-trap immunity flags needed.
4. **A near-black element colour reads as "disabled".** Tar's world-space swatch is
   `timberDark`, and at hotbar size an affordable Tar Seep looked unbuyable. The
   icon uses `dust` instead; the pool on the ground stays dark. Palette discipline
   (§17.9) still has to bend where legibility is a *mechanic*.

### 21.4 M0.7 — upgrades, and making the systems visible

Two gaps M0.6 left. By round 8 you owned five traps and just placed more of the
same, and the synergies scored *invisibly* — a ×3 ignite and an armour clang looked
identical on screen.

| Added | Detail |
| --- | --- |
| **Trap upgrades** (§6) | Ten branches, two per trap, **mutually exclusive and irreversible**. Cost 1.5× base, refunded on sell. Data-only: `RESOLVED[defId][upgrade]` is merged once at module load, so an upgraded trap costs an array index at runtime |
| The branches | Jaws → *Rusted* (bleed, half hold) / *Wolf Trap* (three at once, wider, softer bite) · Tar → *Deep Seep* (wider, stickier) / *Kerosene Cut* (cooks far hotter once lit, soak fades fast) · Vent → *Bellows* (twice as often, weaker) / *Wildfire* (much further, ground stays alight) · Plate → *Black Powder* (huge hit, **no launch at all**) / *Fool's Charge* (barely scratches, hurls them across the room) · Sigil → *Ninefold* (+90% in a doorway) / *Wide Circle* (+30% across half the lane) |
| Upgrade panel | Aim at a placed trap in build mode and the hotbar tip becomes both branches side by side, each with its trade in words. `Z` / `X` to buy. §6's two-branch rule is what lets the whole decision fit on screen with no submenu |
| **Damage numbers** | Pooled DOM spans projected from world space (`render/numbers.ts`). Colour-coded by kind: ignite is the loudest number in the game, `CLANG` is grave-grey because the point is that it did nothing |
| **Hit stop** | 70ms sim freeze on the Boot connecting, presentation still running. Scales the *accumulator*, never the sim step — the tick sequence is untouched, so a replay is bit-identical whether or not hit stop fired |
| Upgraded traps read as upgraded | Wider, hotter reach ring, so a built-out lane is legible at a glance |
| **Tests** | **53** (from 43), including a structural test that every trap offers exactly two branches, each with a blurb stating a trade and an override that differs from its sibling |

**Three things worth recording:**

1. **Wolf Trap promised something geometrically impossible.** "Catches three at
   once" — but separation keeps bodies 0.9m apart, so three of them span 1.8m and
   simply could not fit inside the base 0.85m reach. The test failed at 2-of-3 and
   the fix was to grow the radius with `maxTargets`. A capability upgrade has to
   carry whatever *geometry* it needs, or it's a lie in the tooltip.
2. **The upgrade panel "never appeared" — and it was the harness, not the game.**
   Under pointer lock the mouse reports only deltas, and headless Chrome's
   synthetic moves don't map cleanly onto view rotation, so the crosshair drifted
   ~3m between placing a trap and checking for the panel. Fixed by exposing the
   crosshair's grid cell on the debug hook and having `capture-game.mjs` close the
   loop — aim, read, nudge, repeat — instead of guessing screen coordinates. Worth
   the detour: the attract-mode capture at §19.2 will need exactly this.
3. **Damage numbers are DOM, deliberately.** World-space text needs a font atlas,
   an SDF shader and per-glyph instancing; 32 absolutely-positioned spans need
   none of that and render crisper at 12px than any texture atlas would. Behind a
   `push()` call, so the M4 VFX system can swap in instanced quads later.

### 21.5 M0.8 — audio, synthesised

The game was **completely silent**. §16 opens by saying audio is ~50% of perceived
quality in a horde game and is usually the first thing cut, and it was:
no revolver crack, no trap snapping, and — worse — no way to know a leak had
happened somewhere off-screen.

This ships the **real §16 architecture** with **procedurally synthesised** sources.
Not because generated samples are wrong (§16.4 plans them) but because a synth set
costs nothing, needs no assets, and makes the game audible *today*, which is what
tells you whether the mix and the mapping are right. Real one-shots drop in behind
the same `play()` call later.

| Added | Detail |
| --- | --- |
| The graph | Four buses (SFX / MUSIC / UI / AMBIENCE) → master compressor. Buses so the music can duck under the Bell; the compressor because forty bodies will otherwise clip the master every wave |
| Voice pool | 32 voices with priority stealing and distance culling: free slot → lowest priority → furthest at equal priority → oldest at equal distance. A grunt can never silence the player's revolver, and a distant duplicate is the one nobody misses |
| 26 synthesised sounds | Each layered the way a designer would (§16.4): transient + body + tail. The revolver is a noise crack over a low thump over a room tail. Struck metal uses the inharmonic bell series, which is what makes iron sound like iron |
| Layered music | A continuously-running graph with moving gains, not tracks that start and stop: harmonium drone always, a boot-thump pulse during combat that quickens with pressure, a minor choir cluster that fades in with the body count. D dorian / 84 BPM per the §16.4 Act I row |
| Positional audio | Stereo pan from a dot product against the camera's right vector, not a `PannerNode` per voice — a tenth of the cost for a camera that barely needs elevation cues |
| Ducking | Ignite, the Bell and a leak all push the music bed down, so information wins over atmosphere |
| Mute | `M`, persisted to localStorage. Presentation-only, so it never enters a replay |
| **Tests** | **65** (from 53): 12 new, covering voice allocation and stealing order, positional pan/falloff, and an exhaustiveness check that every `EV.*` kind is either handled or *explicitly* ignored |

**Four things worth recording:**

1. **The renderer was clearing the event ring.** Audio reads the same events, and
   whoever cleared first would silence the other. The host now owns the drain —
   which is what §12.4 always said (`EventFlushSystem` drains to presentation *and*
   audio *and* UI), just not what the code did.
2. **A silent regression is the hardest bug class to notice** — nothing looks
   broken, the game just quietly stops telling you things. So the mapping test
   reads `audio/index.ts` and asserts every event kind appears, forcing new events
   to be either wired up or deliberately marked silent.
3. **Voice allocation is a set of rules, so it lives in a pure module.**
   `audio/pool.ts` touches no AudioContext and is tested in plain Node. Priorities
   encode design: `synergy` outranks `trap`, because an ignite landing is
   *information* (§6), not decoration.
4. **Verifying audio headlessly needs the game to report on itself.** Headless
   Chrome has no output device, so "did it make a sound" cannot be observed from
   outside. The debug hook now exposes AudioContext state, live voices, peak voices
   and total sounds played — and the capture harness confirmed `running`, peak 2,
   5 sounds in one scripted round.

**Two collaboration notes**, since `game/src/render/` was being edited in parallel:
a mid-save build caught `scene.ts` calling helpers whose module existed but hadn't
saved yet (false alarm, not a real break); and the `Fog` import that my hurt-flash
vignette relied on was removed when lighting moved to `look.ts` — fixed by dropping
the cast entirely, since `Scene["fog"]` already exposes `color`. Two mechanical
`erasableSyntaxOnly` violations in the new `shelf.ts` and `models/traps.ts` were
expanded the same way §21.1 did (no parameter properties, no literal-narrowed
comparisons).

### 21.6 M0.9 — replays, and a score that survives the tab

The whole design rests on "the highest round you reached is the score" (§4), and
until now that number evaporated on refresh. §13 had the other half of the problem:
it made the sim deterministic and hash-checkable and then never recorded anything,
so every promise resting on replays — bug repro, attract mode, leaderboard
verification, co-op desync detection — was still just a comment.

| Added | Detail |
| --- | --- |
| **Replay recording** | `sim/replay.ts`: run seed + sparse command log + hash checkpoints every 600 ticks. Not a video and not a state dump — the *inputs*, replayed through the same sim |
| **`verify()`** | Replays a recorded run and checks it against its own fingerprints, returning the first divergent tick. This is the function that makes §13 real rather than aspirational |
| Export | `SAVE REPLAY` on the death screen writes a `.ghreplay`. Measured: a 10-minute run is **~40KB** — small enough to store per leaderboard entry, exactly as §13 estimated |
| **Local profile** | `host/persist.ts`: `player_key` (no accounts, no PII), best round, best tally, runs played, last 20 runs. Local-first per §18.3 — `localStorage` is the source of truth and the server will be a mirror, so nothing migrates when the leaderboard lands |
| UI | The record card on the title/death screen, a "new best" line, and a `BEST n` chip beside the live round so the number on screen has something to beat |
| **Tests** | **78** (from 65). 13 new: sparse-log correctness, checkpoint schedule, exact reproduction, text round-trip, tamper detection, version and malformed-input rejection, replay size, and the pure profile merge/cap/repair logic |

**Four things worth recording:**

1. **The tamper test passed when it should have failed — and that exposed a hole in
   the test script, not the sim.** Arming a hotbar slot enters build mode (§6) and
   nothing in the script ever left it, so the player spent the entire recorded run
   holding a trap and *every* `fire` command was silently discarded. The injected
   extra shot was a no-op, so the run still verified. Fixed by holstering before the
   round starts — which also means the replay test now actually exercises the
   weapon and hitscan, which it never had.
2. **The tamper defence works in both directions**, and there's a test for each:
   editing the *command log* fails verification, while editing the claimed *score*
   verifies fine but replays to a different tally — which is precisely why §18.3's
   server can recompute rather than trust.
3. **Finishing a run is a host concern, not a sim one.** `maybeFinishRun()` lives in
   the loop because the simulation's job ended when it set `PHASE.lost`; giving it a
   `localStorage` dependency would break every headless test in `tests/`.
4. **A damaged profile must never cost you the game.** `normalize()` repairs missing
   or corrupt fields and `saveProfile` swallows quota errors — verified in a real
   browser by writing `{not valid json` into storage and confirming the game still
   boots clean.

**Commands:**

```bash
npm run dev:game       # Vite dev server on :3040 with HMR
npm run test:game      # 78 tests: sim + audio + replay
npm run build          # portfolio, then the game into build/hymn/
npm run test:smoke     # boot the built game in real Chrome, assert, screenshot
node scripts/capture-game.mjs --round     # drive a scripted round and screenshot
node scripts/capture-game.mjs --upgrade   # capture the upgrade panel
```

### 21.7 M1.0 — the site system, and four bugs it exposed

`GALLOWS_HYMN_MAPS.md` §9 lists nine engine changes its five anchor sites need and
says of the first: *"Everything else here depends on this landing first."* This is
that item, plus the four it directly unblocks, plus **Map 01 authored to its build
table**.

| Landed | Detail |
| --- | --- |
| **`SiteDef` registry** (§9 item 1) | `sim/sites.ts`. `WIDTH`/`DEPTH`/`CELL` and one hard-coded `buildBoxes()` were module constants, so the game had one map forever. `buildLevel(siteId)` now takes a site |
| Kit extracted | `sim/kit.ts` — `wallRun` / `block` / `pillar` / `steps` / **`deck`** |
| **`BOX.deck`** (item 2) | The one kit piece with a non-zero `y0`. 0.30m, never 0.35 — putting a deck exactly at `PLAYER.stepOffset` lands the map on the wrong side of a float comparison |
| **`groundHeight` honours `y0`** (item 3) | Test written first, as the doc instructed |
| **`isPlaceable` by kind** (item 4) | Plus an authored `noBuild` flag, because the plinth and Map 02's boardwalks are both decks and only one may take traps |
| **`gates[].fromRound`** (item 6) | §4's spatial escalation. Boot Hill opens its second gate at round 3 |
| **`rebake()`** (item 8) | Extracted, ready for Map 02's player-mutable geometry |
| **Surface census** (§3 G7) | Every site declares floor/wall/ceiling/sigil/env counts, and **director composition constraint #6** reads it: an archetype whose answer the site does not have is barred, and Buzzards are capped at `2 × ceiling`. §8's table assumed the answers existed; now the game checks |
| **Map 01 — Boot Hill, First Light** | 48×32, two gates, the crypt row, the orchard fence with its deliberately unsealable pinch, 24 headstones. Rounds 1–3 of every run |
| Site rotation | Rounds 1–3 Boot Hill → 4+ the retained M0 pinch. Travelling **refunds the whole build in full**, including upgrades: losing a round's spending to a transition the player did not choose would punish progress |

**Four real bugs, all latent since M0, all found by playing Boot Hill:**

1. **A body standing in a blocked cell's skirt froze forever, softlocking the
   round.** `blocked` is inflated by the agent radius so the field never routes into
   a wall, but collision only ejects from *actual* geometry — so a body could
   legally stand where the field had no direction at all, and simply stop. Six
   Dustkin were found motionless at (16.1, 10.1). Fixed with `flowDir()`: a ring
   search for the nearest cell that knows the way, and failing that, straight at the
   Rift. Better a body pressed against a wall than one that never moves again.
2. **Steps were decorative. Nothing could ever climb them, player included.**
   `resolveCircle` treated *any* box overlapping the body's vertical span as a wall,
   so a 0.45m tread was impassable to a 1.8m body — and the authored rise (0.45)
   exceeded `PLAYER.stepOffset` (0.35) anyway, so no collision fix alone would have
   helped. Now: step-up allowance in collision, and treads at 0.30.
3. **Pathing and collision disagreed about what is solid.** `bakeBlocked` ignored
   anything under 1m; `resolveCircle` blocked anything above the step height. A 0.9m
   headstone was therefore invisible to the field and solid to the body walking into
   it — the field said west, collision said no, and the body wedged there for the
   rest of the run. Both now share one predicate, `isSolidKind`, and decor is a
   `BOX.prop` that neither treats as an obstacle.
4. **An authored gate a metre from the wall spawned bodies through it.** The ±1.4m
   spawn jitter crossed the perimeter and collision ejected them *outside* the
   level, where they shoved uselessly at it forever. The director now clamps every
   arrival into bounds and off blocked cells, so no authored map can cause it.

Tests: **106** (from 78). The new `tests/sites.test.ts` holds both authored sites to
the same §11 guarantees the generator must obey, because an authored map that breaks
them is a content bug that should fail in `node` rather than in someone's run.

### 21.8 M1.1 — wall and ceiling traps

`GALLOWS_HYMN_MAPS.md` §9 item 5: **surface classes**. Until now `isPlaceable`
returned one boolean, every trap in the catalog was a floor trap, and §6's rule that
"placement is validated against surface tags" had nothing to validate against — so
the `wall` and `ceiling` columns of every site's census described surfaces nothing
could use, and the Buzzard's only answer was the revolver.

**Mounts are authored, never inferred.** This is the decision the rest follows from.
The obvious build is a grid on every wall, and it is wrong: MAPS §3 says a mountable
face is a design decision, *"a crypt has three usable faces, not six"*, and Boot
Hill's census claims **3** wall faces where its raw geometry has about forty. A grid
would promise all forty. So a `SiteDef` lists its mounts, the census is **derived**
from that list (§3 G7 can no longer drift), and the player sees chalk marks at the
real mount points rather than a lattice of lies.

| Landed | Detail |
| --- | --- |
| `sim/surfaces.ts` | `SURF` classes, `SurfaceSlot`, side normals, `censusOf` |
| Mount id space | A mount is addressed as cell `SLOT_BASE + n`. One `cell` field still identifies every trap, so `place`/`sell`/`upgrade`, `trapAtCell` and the replay format needed no change — the alternative threaded a second id through commands and would have bumped `REPLAY_VERSION` for nothing |
| `TrapDef.surface` | Placement gated by `isPlaceableFor`; both directions tested |
| `TrapDef.reach` | ground / air / both. Airborne includes *launched* bodies, so a Bone Plate feeding a Buzzard Roost is a designed pairing, not a coincidence |
| 3D reach test | A ground trap stays a 2D puddle; an air-reaching trap is a volume at its mount height, or a beam 4.4m up would hit a flier directly beneath it as easily as one at its own altitude |
| Four traps | **Scattergun Ports** (wall, shoves bodies off their line), **Barbed Coil** (wall, slows them into your auras), **Hex Lantern** (wall, marks everything it lights *including fliers*), **Buzzard Roost** (ceiling, the only reach into the air) |
| Four models | Authored to a new convention — centred on the mount, `-Z` outward — since a mounted trap is placed *at* its bracket rather than standing on the floor |
| Chalk marks | Every free mount of the armed class, oriented to its face |
| Hotbar | 9 slots, each mounted trap wearing a `WALL`/`ROOF` badge, and the tip saying what to aim at |

**The Buzzard finally has an answer.** §8 listed its counter as a roost and the
Rattler's as "wall and ceiling coverage"; neither existed. The Roost is deliberately
**air-only** — one that also shot the ground would be a strictly better floor trap
and altitude would stop mattering — and the Lantern is deliberately its *partial*
answer: a lantern cannot kill a flier, but everything else you own hits it harder
while it is lit.

**Aim is snapped, not raycast.** A wall face has no ground plane and a beam is over
your head, so mounts are picked by proximity to the aim ray inside a cone that
widens with distance. That forgiveness is the requirement, not a shortcut: the
camera is 3.4m behind the player's shoulder, so crosshair and hand are never in the
same place. M0.9 spent a while on an upgrade panel that "never appeared" and was
entirely a ~3m crosshair drift.

**Two things I got wrong, recorded because both were instructive:**

1. I replaced the models' winding test with an "orientation-independent" one and
   claimed it was better. It is not — measured, `tar` scores **-0.028** with
   perfectly correct winding, because flat models cluster at zero. Dropped rather
   than tuned to pass. Mounted traps therefore have **no** winding assertion; the
   shared primitives are still covered by the primitive tests and by all five floor
   traps, so what is unguarded is narrow (a mounted model assembled inside-out from
   correct parts) and stated rather than papered over.
2. The first reach test faked an airborne body with `grounded = 0`. It *fell*,
   landed, and was clamped by the very ground trap the test was proving could not
   reach it. Pinning a real Buzzard isolates the predicate from flight and gravity.
3. `verify-mounts.mjs` then failed to snap to any mount, and the game was right
   again: its first `mouse.move` was a large *delta* from the play button that flung
   the camera off the lane before the first sample was read. With no mouse movement
   at all the spawn aim is already on the middle crypt. Under pointer lock, not
   moving is the reliable option — the identical trap as M0.9's upgrade panel, which
   is worth noting twice because it has now cost time twice.

Verified in a browser as well as headless — `scripts/verify-mounts.mjs` arms a wall
trap, confirms the site offers exactly its authored 3 mounts, sweeps until the
crosshair snaps to one, places it, and checks the trap is off the floor. Tests:
**165**, of which `tests/surfaces.test.ts` is 19.

**Deferred, and stated as such:** sigil mounts are authored and counted but no trap
consumes them yet (the Sigil of Nine is still a floor trap); `env` hooks (item 7,
the hanging tree) and per-site fog (item 9) remain open.

### 21.9 M1.2 — two grids, and a trap that changes the map

Two changes, in the order they had to happen.

#### The build grid is 2m; the nav grid stays 1m

Coarsening one shared grid to 2m does not work, and the arithmetic says so rather
than a hunch: `bakeBlocked` marks every cell *touched* by geometry inflated by the
0.45m agent radius, so at 2m Boot Hill's 0.6m orchard fence claims a **4m** band and
its deliberate 4m gap becomes two cells that the two fence segments each claim.
Zero passable cells — the M1.0 softlock again (§21.7 bug 1).

So `Level` carries two grids. `cell`/`gw`/`gh` remain the nav grid behind `blocked`,
`dist` and the flow field; `tile`/`tw`/`th` are the build grid that traps snap to.
They are named apart (*tile* vs *cell*) deliberately: both are `number`, so **`tsc`
cannot catch a miscategorised call** — the split compiled clean on the first try
while three call sites were still silently wrong. Every call site was classified by
hand; only three in `src/` were build-space.

| | |
| --- | --- |
| `BUILD_TILE = 2` | One knob. It drives tile size, trap model scale, the ghost and the grid overlay together |
| `isPlaceable` | Now a **footprint** test, because a 2m tile whose centre is clear can still have half of itself inside a wall. It also stopped using `blocked`: that array is inflated for *walking*, and a trap may sit flush against a wall a body could never stand 0.45m from |
| Trap models | Authored at 1m and scaled by `BUILD_TILE`, so `0.62` stays a hand-sized part at any tile size |
| Radii | Tile-scale traps **doubled**; a 2m tile's circumscribed radius is 1.41m, so anything under that leaves its own corners untouched and bodies clip past. Lane-scale traps grew 1.2–1.6×: doubling the Roost's 9m would swallow most of a 48×32 site |
| Costs | **Unchanged, deliberately.** Tiles fell 4× while tile-scale coverage rose 4×, so "lane covered per scrap" is the same number |

The world did *not* get bigger. The player is still 1.8m and a Dustkin's radius is
still 0.45m; only the lattice changed.

**What the tile change exposed, which is worth more than the change itself.** Every
hardcoded grid id in the test suite was a nav cell, and several had been dead for
milestones:

- `sim.test.ts`'s determinism script placed traps at cells 1467–1471, all of which
  are `blocked = 1, dist = Infinity` inside the north wall's skirt. **All four
  placements had been refused since M0** — in a script whose comment says it
  exercises "every trap". A determinism test passes just as happily on a run where
  every command was rejected.
- `replay.test.ts` used 730/729/774; two sit inside the Rift's 2.2m keep-out ring, so
  only the tar ever landed.
- The same script was then *also* priced out: four traps cost 175 against a round-1
  purse a fraction of that.

Fixed by computing tiles from metres, funding the worlds, and adding the assertion
whose absence hid all of it: **`assert.equal(w.traps.count, 4)`**. Hardcoded grid ids
are the real defect — they cannot be wrong out loud.

#### The Dead Man's Brace

The first trap that changes the *map*: a barricade that reroutes bodies instead of
touching them. Unbreakable for now, and **enemies only** — you and your shots pass
straight through your own, so it is a pure path-shaping tool.

- `Level.blockTiles` (a flag per build tile) plus `blockBoxes`, rebuilt by `rebake`
  — which is why `rebake` was extracted in §21.7. Blockades stay **out of
  `level.boxes`** so they are invisible to player collision and hitscan, and
  `resolveCircle` takes a `withBlockades` flag that only the enemy caller passes.
- `TRIGGER.inert`: it works by existing, so the trap system skips it entirely.
- `upgrades` became **optional**, because an unbreakable obstacle with no effects has
  nothing to choose between and §6 forbids inventing a pair to fill the slot. The
  rule was then *narrowed* rather than loosened — only an obstacle may go without, so
  a damage trap still cannot ship unbranched. That optionality immediately exposed a
  bug: `upgradeTrap` would take full price, mark the instance, and resolve straight
  back to the base def.

**The rule: a lane can be narrowed but never sealed.** `wouldSealLane` is pure —
two BFS passes over preallocated scratch, mutating and allocating nothing — because
the build ghost asks it **every frame from the host**, and a mutate-test-restore
version would have the renderer writing sim state, breaking §12.2 and determinism
together. A test fingerprints the whole level around a call, and another checks the
preview against what `rebake` actually does, so the ghost can never go green on a
placement the command system then refuses.

It compares against **what is reachable now**, not against the gate list. Some gates
are legitimately unreachable already — Undertown's Fall breach sits behind a building
the player has not paid to open — and "every gate must reach the Rift" would refuse
every blockade on that map forever.

**A wrong test found the right invariant.** The first version filled Boot Hill's 4m
gap and expected a refusal. None came, and the game was right: the fence stops at
z=26 and the southern loop goes round it, so sealing the pinch is legal and costs the
bodies distance rather than a route. "Every chokepoint stays open" was never the
promise. The test now asserts the property directly and depends on no map trivia —
greedily build on every tile the game allows, on both sites, and every gate must
still reach the Rift afterwards.

Also fixed: with ten traps plus the revolver row the hotbar needs **eleven** keys,
and the Brace was the tenth trap — reachable only by mouse wheel. `-` and `=` now
continue the number row, and the HUD hints say so.

Tests: **188** (from 177), of which `tests/blockade.test.ts` is 11.

**Still open from this request:** the wall grid — walls divided into their own
placement lattice, traps anywhere on them, and special no-build faces marked by
material. That inverts the mount system from authored *inclusions* to authored
*exclusions*, and is the next piece.

### 21.10 M1.3 — walls become a surface

#### The lattice, and the inversion

M1.1 had maps *list* the faces a trap could bolt to. Played, that scarcity read as
**arbitrariness** — nothing about the third crypt explains why it takes iron and the
fence beside it does not, and a player cannot plan around a rule whose shape they
cannot see. So the polarity flipped: **every exposed wall face is a lattice of build
tiles**, derived from geometry exactly as the floor grid is, and a map declares the
faces that **refuse** traps.

| | before | after |
| --- | --- | --- |
| Boot Hill | 3 authored mounts | **220 buildable + 26 refused** |
| Hollow Creek | 10 authored | 216 |
| Undertown | hand-listed `UNDERTOWN_SURFACES` | **1,416 + 48**, nothing maintained |

Three things fall out of deriving rather than authoring: nothing to keep in sync (a
map that grows a building grows wall tiles); the census stops being a promise and
becomes a *measurement* (§3 G7); and placement becomes **exact** — a face lattice has
real cells, so the crosshair raycasts onto one instead of snapping to the nearest
point within a forgiving cone. That tolerance was always a symptom of mounts being
sparse points rather than a surface.

Exclusions are the rare, explicable case and are painted oxblood, permanently visible
whether or not anything is armed — *where you may build* is a question you ask while
building; *where you may never* is a fact you should be able to plan around on the way
in. Boot Hill refuses its crypt row (consecrated ground); Undertown refuses the rib,
using the map's own words — "untouched strata the town was built around".

**An honest consequence:** wall scarcity is no longer a lever a map can pull. Ceilings
still are — one roof beam is one *place*, not a surface — so the director's archetype
gate moved onto a new `ceilings` requirement.

#### Walls in three dimensions

Boxes were flat slabs. Now every wall, block and pillar wears **coursed panels** laid
on its vertical faces, on the same 2m squares traps mount on — so the masonry a player
is looking at *is* the grid they are placing into.

That last claim was false when first written, and the fix is the interesting part.
The lattice and the mesher were two implementations of "where a wall's squares are",
and they drifted: the lattice counted rows up from a minimum mount height while the
mesher divided each face into equal parts, so on a 4m wall the courses were drawn at
y = 1 and 3 while traps mounted at **1.8 and 3.8** — every wall trap floating 0.8m
above the square it appeared to sit on. Both now call one function, `faceSquares`,
so the claim is true by construction rather than by coincidence.

The squares are **world-aligned, exactly like the floor**. `tileOf` buckets the floor
by `floor(x / tile)`, so bucketing walls the same way puts a wall square directly above
the floor square beneath it, and makes a two-square-high wall read as two squares.
Centring the lattice on each *face* instead — the mesher's original scheme — leaves two
walls meeting at a corner with courses that do not line up, and nothing hides that. A
square survives only if three quarters of it lies on the wall, which also guarantees
its centre does, so a trap can never mount on a square mostly hanging off a fence end.

Panels stand **proud**, not recessed, and both halves of that matter. Recessing needs
the flat face cut away around each panel, and any gap in that cut is a hole you can
see the sky through; laying courses on the intact box can never hole. Proud also
changes the **silhouette**, which is most of what makes a wall look three-dimensional
from across a room — far more than face detail does. Depth varies per course from
hashed noise, never `Math.random` (§13 rule 2). Cost: Boot Hill 1k → **4.7k**
triangles, Undertown **27k**, against a 1.2M budget.

#### Rough surfaces, generated not painted

There are no image files in this project and won't be — Path A plus "never used
Blender, won't spend money" rules out a painted texture. So `render/textures.ts`
generates the grain at load: coarse mottle that reads across the site, fine speckle
that reads at arm's length, and **vertical streaking**, because weathering runs *down*
and biasing the noise along one axis is the difference between "noisy" and "rained
on". World-planar UVs (triplanar-lite) keep the grain the same physical size on every
surface — any per-box scheme would make it change size wall to wall.

It only ever darkens, since `map` multiplies, and the range is deliberately narrow
(0.78–1.0): under a three-band toon ramp a texture that swings too far stops sitting
*under* the bands and starts competing with them. Work is split by scale —
silhouette to geometry, blotching to vertex colours, fine grain to the texture — so
nothing pays triangles to carry colour.

#### No clipping

**Scattergun Ports sank 0.44m into the masonry**, and nothing failed. Fixed in the
renderer, not the sim: a wall trap logically *is* on the face, which is where its
effects should originate, so only the mesh needed moving. The distance is measured off
the model (`trapBackDepth`) rather than authored beside it, so re-modelling a trap
cannot leave a stale number behind, and `PANEL_PROUD` is added to clear the new
courses. The ghost and the lattice marks get the same offset — marks drawn at the
nominal plane would z-fight the masonry and flicker.

`tests/walls.test.ts` rebuilds what the renderer does and asserts no vertex of any
wall trap ends up on the wall's side of the face plane, on 40 real tiles across all
four facings.

#### Also this increment

- **Placement near walls was badly broken**, and it was mine from M1.2. `isPlaceable`
  refused on *any* solid overlap, so a 0.6m perimeter wall centred on the boundary —
  reaching 15% into the first tile — killed **every border tile on every map** (76 on
  Boot Hill), plus a column beside every fence. Now an area rule: a tile is a trap bed
  if it is *mostly* open floor (≤25% covered), with a centre test so nothing sits
  inside a pillar.
- **Reachability was tested at the tile's centre nav cell**, which lands inside a
  wall's *inflated* skirt — a fact about where a body's centre may be, not where iron
  may go. Worse, it was asymmetric: a 48m map puts tile centres at 1.0 and 47.0, and
  only the far one falls in the skirt, so one border died and the opposite one lived.
  Any covered nav cell now counts. Boot Hill: **219 → 330** placeable tiles, border
  **34/76 → 70/76**.
- The Rift keep-out, which M1.2 inflated by half a tile, is back to the true ring. G2
  asks that no trap sit *in* the ring — a question about the trap, not its tile.
- **The Dead Man's Brace is a flat square filling its tile**, with a rust kerb so two
  abutting read as one wall. Flat is right for the trap you use to reason about paths:
  a chest-high barricade hides the ground you are planning on. Its collision volume
  stays 2m (it must clear `bakeBlocked`'s 1m threshold) — the plate is the read, the
  volume is the rule.
- `slotOfCell` decoded a **wall** id as a nonsense mount, because the ranges overlap.
- A 4m wall yielded **one** row of tiles, not two: the row count asked how many whole
  steps fitted above the minimum instead of how many row centres fit under the top,
  throwing away the upper half of every wall on every map.

#### Every side face in the site mesh was inside out

Reported as "some of the walls are still invisible", and it had been shipping **since
M0**.

`emitBox` listed the corners of all four *side* faces in the order that makes the
geometric normal point back into the box. Under the default `FrontSide` material every
one of them was back-facing and culled, so looking at a wall you saw straight through
the near face to the inside of the far one. Only the top face was ever wound correctly
— which is why the floor, which shares its corner order, always looked right.

It survived three milestones because **lighting reads the supplied `normal` attribute,
not the winding**. The faces that did draw were shaded correctly, so nothing looked
broken; the site just looked oddly flat, and every explanation for that pointed
somewhere else — the palette, the fog, the toon ramp. Adding panelled relief made it
worse rather than better, because the panels inherited it.

The invariant is checkable without a GPU and is now asserted for every triangle the
mesher emits, panels and floor included:

```
cross(b - a, c - a) · declaredNormal > 0
```

Two smaller things the same look-through-the-geometry pass turned up:

- **Panels were shaded twice.** `emitPanels` passed the parent face's shade into
  `emitBox`, which applies `FACE_SHADE` per face itself — so a course came out at
  0.25× where the wall behind it was 0.5×, reading as grime at best. (Fixed once,
  reintroduced by a later rewrite of that function, hence the note in the code.)
- **The no-build overlay was too strong at 50%**, painting a whole crypt oxblood: it
  stopped saying "you cannot build here" and started saying "this object is red".

#### The audit that should have existed first

The winding bug was found by a check that needs no GPU, no browser and no screenshot,
which makes its three-milestone survival a process failure rather than bad luck. So the
check was generalised into `tests/geometry.test.ts` and pointed at **every** generator
in the game — traps, the roster, the hero, dressing, hills, floors and site boxes —
not just the one that had the bug, because the reason it hid applies equally to all of
them.

Result: everything else was already correct. Worth recording precisely because a clean
audit is the useful outcome, and now it cannot quietly stop being clean.

Two things the audit taught about auditing:

- **The skydome reported 59 backwards triangles out of "141.67".** Not a whole number
  of triangles, which was the tell: it is *indexed*, and the probe was walking positions
  sequentially instead of through the index. It is also drawn `BackSide` — a shell you
  stand inside, so it is *supposed* to face inward. Both the bug and the exemption were
  in the tool, not the game. The committed version reads the index and says why the sky
  is excluded.
- The same pass checks **unit-length normals** and **degenerate triangles**, because
  toon shading quantises `dot(N, L)` — a normal that is not unit length lands in the
  wrong band and shows up as a hard-edged patch on a surface that is otherwise fine.

#### Marks were rebuilt every frame

The wall lattice is a *function of state* — it changes when the level changes, when a
trap is placed or sold, or when a different trap is armed, and on no other frame. It
was being rebuilt unconditionally, which on Undertown cost **93,696 trap scans, 1,464
matrix writes and a ~90KB instance-matrix upload per frame** to produce a picture
almost always identical to the previous one.

Now signature-cached, the same discipline as `hudSignature` (§14.1 budgets the frame
tightly enough that "recompute it, it's only a loop" has to be a decision rather than a
default). The signature hashes trap **cells**, not the trap count — selling one and
building another elsewhere leaves the count identical and the marks different. The
rebuild itself also stopped calling `trapAtCell` per tile, a linear scan of all 64 trap
slots, in favour of one pass over the traps into a set.

Also checked and found sound, recorded so it is not re-derived: §8's contract that an
enemy's answer is available by the round it debuts. The Buzzard arrives at round 5
against gross income of ~764 for a 120-scrap Roost, on a site with 14 roof anchors.

Tests: **214**, adding `tests/wallgrid.test.ts` (12), `tests/walls.test.ts` (12) and
`tests/geometry.test.ts` (3).

**Verified headlessly only.** The browser harnesses are no longer run without being
asked for — they drive a real Chrome, `/hymn` takes pointer lock, and scripted mouse
moves therefore seize the machine's actual cursor. See CLAUDE.md §0.

### 21.11 M1.4 — the tally board

§18.3, and the thing asked for on day one: *"a leaderboard for all players, wont be
much."* One Vercel function (`api/game/[action].js` → **6** of the Hobby plan's 12),
one `gh_scores` table, and the same shape as `reckoning.js` — Neon, a table created
once per warm instance, salted IP hashes never addresses, a honeypot field, and
`configured: false` rather than an error when there is no database.

**One row per player, not per run.** The board answers "how far has each person got",
so a table of every attempt would be mostly rows to filter out, growing without bound
while storing a replay each. `UNIQUE (player_key)` plus an upsert guarded by
`WHERE EXCLUDED.round > gh_scores.round` keeps it one row per person and makes a later,
worse run unable to overwrite a better one — without the client being trusted about
what its own previous best was.

#### What the replay buys, and what it doesn't

The server **cannot** prove a run happened: that needs the simulation, which is ESM
TypeScript running in the browser and in `node --test`, not in a CommonJS serverless
function. Bundling it to re-run every submission is a large dependency for a
leaderboard that "won't be much".

So it checks the claim is *internally coherent* instead. A replay is a seed, a sparse
command log and a fingerprint every 600 ticks, and those have to agree with each other
and with the outcome claimed:

- commands in order and inside the run
- checkpoints in order, and **exactly** `floor((ticks - 1) / 600) + 2` of them —
  `Recorder.finish` always takes a final fingerprint, so the count is exact rather
  than a range, and it is the single hardest part of a forgery to get right by accident
- a round that fits in the ticks the replay says it took
- caps on round, kills and blob size

Forging a round-50 run therefore means producing a coherent command stream of plausible
length with correctly spaced checkpoints — most of the work of writing the replay
system, rather than editing a number in a POST body.

**And the blob is kept**, so exact verification is a replay away — `verify()` already
does it, in any visitor's browser, for free. The board makes a claim the reader can
check rather than one they have to accept. `GET /api/game/replay?player=…` serves it,
deliberately as a separate request: 19KB per four minutes of play would make a 25-row
board megabytes wide for a feature almost nobody uses on a given visit.

#### The test that matters

`api/_lib/hymn-run.test.js` (20 tests) checks the rules against replays *it builds
itself*, which proves only that the rules are self-consistent. The real risk is
quieter: **the validator describes `Recorder`, and `Recorder` can change.** Bump
`HASH_INTERVAL`, take one more fingerprint, add an outcome field — and the server
starts rejecting every genuine run while both suites stay green.

So `game/tests/leaderboard.test.ts` plays real rounds, records them with the real
`Recorder`, and pushes the result through the real validator, loaded across the
module-system boundary with `createRequire`. It asserts the shared constants match and
that runs of 1s, 9s, 10s, 11s, 60s and 240s all pass — the boundaries either side of a
checkpoint tick, where an exact count is most likely to be wrong.

#### Never in the way

The board is a nicety on a hidden page, so every failure — offline, 404, cold start,
a deploy with no `POSTGRES_URL` — resolves to "no board" and is never raised as an
error. Submission is fired without being awaited from the frame that detects the loss,
because the death screen must appear on that frame regardless. With no database
configured, the leaderboard simply never appears, and nothing explains why.

Tests: **240** — 220 in the game, 20 in the API.

**Next:** the board lists runs but nothing yet calls `fetchReplay` to *recompute* one,
which is the feature that makes it more than a list of numbers. The client half of
that already exists on both sides (`verify()`, `GET replay`); it needs a button and a
result to show.

### 21.12 M1.5 — closing M2's stragglers

`GALLOWS_HYMN_MAPS.md` §12 puts engine items 5 and 7 at M2. Eight of the ten items
were done — items 9 (per-site atmosphere) and 10 (ghost paths) landed alongside this
work — and these two were the tail.

#### Item 5: the chalk had no consumer, because the Sigil was in the wrong family

Every site traced chalk circles, the census counted them, and `siteCanAnswer` could
gate a whole archetype on `sigil >= 4` — while **no trap in the catalog could be
traced on one**. The cause was a straight misreading: §6's catalog lists the **Sigil
of Nine as #19, in the sigil family**, and it shipped as a floor trap.

That mistake had a second cost. The strongest amplifier in the game — 90 scrap for
+50% damage in a radius — was placeable on any of ~330 floor tiles, when it is meant
to be scarce. Boot Hill traces four circles and Hollow Creek six, so *where the Sigil
goes* is now a decision the map makes half of, which is what an amplifier that
expensive should be.

**Unhallowed** is implemented as the rule it actually is: a *region* of ordinary floor
that accepts `ELEM.arcane` and nothing else. Deliberately separate from
`isPlaceableFor`, because it constrains the trap's **element**, not the surface it
sits on — conflating those is what would make "sigil" and "unhallowed" look like the
same idea. No site declares one yet; Map 05 is the first, and §21 lists it first to cut.

The guard that would have caught this now exists: **every surface class a site
authors must have at least one trap that can use it.** Authored data nothing consumes
does not look broken — it looks finished.

#### Item 7: environmental one-shots

§4 promises "1–3 environmental trap slots, free to activate once… the generator
guarantees at least one per site." `UNDERTOWN_ENV` had named a hoist, a chandelier, a
bell and the winding gear; nothing could fire one. Boot Hill and Hollow Creek had
none at all, so the guarantee was false on two of three sites — now they have the
hanging tree and the winding gear.

**They are shot, not pressed.** The obvious build is an interact key and it is the
wrong one: this is a shooter whose fantasy is a lantern in one hand and a revolver in
the other, and "shoot the rope holding the chandelier" needs no key, no prompt and no
tutorial. It also collides with nothing (`E` is the Boot). The cost is a rendering
obligation — an env slot has to *look* shootable.

The hit test runs against the same `bestT` as bodies and walls, so a Dustkin standing
under the tree eats the bullet instead of the rope. That is the correct outcome and
the reason the shot is worth aiming.

They apply a **hold** as well as damage, and the hold is the point: a thing that deals
240 damage is a big trap, where a thing that deals 240 *and pins whatever survives*
creates a two-second window the whole build gets to use. `used` lives on the level, so
travelling restores them — once per **site**, not once per run.

**Deferred honestly:** "then cost salt to reset" is not implemented, because **salt
is not implemented** — it is the §5 meta currency and nothing in the sim tracks it.
`resetSalt` is carried on every definition so the maps stay truthful, and the moment
salt lands this becomes a spend rather than a rewrite.

Tests: **248** — 228 in the game (adding `tests/env.test.ts`), 20 in the API.

### 21.13 M1.6 — Map 04, The Crossroads

MAPS §13 open question 1: *"Does a no-pinch map work at all? Map 04 is the one
genuinely unproven design here. It is grey-box-testable at M3 for about a day's work,
and it should be tested before anything is drawn."* Built first for exactly that
reason — ahead of Map 03 and the chunk cut, because it is the assumption most likely
to be wrong and the cheapest one to falsify.

56 × 56, four roads, four gates open from round one, the Rift at the centre of all of
it. Site rotation is now Boot Hill 1–3 → Undertown 4–9 → **the Crossroads 10+**, which
matches §7's "boss round 10, then rounds 12+".

**Two pieces of geometry are load-bearing, and both are subtle:**

- **The scaffold.** Four roads pointing at the centre is four gates with a clean shot
  at the Rift, which breaks G2 and makes §8's Deadeye constraint *unsatisfiable* —
  there would be no legal Deadeye gate anywhere on the map. Four uprights and a plank
  skirt break the eye line from road level in all four directions.
- **The skirt is `BOX.prop`, not a wall.** §7 requires "the ground itself completely
  open to walk across", and a 1.1m solid ring around the Rift would seal the flow
  field's only source — every cell on the map unreachable, which is the M0 softlock
  (§21.1 note 3) rebuilt on purpose. Props are exempt from `isSolidKind`, so it
  occludes without existing to pathing or collision.

The Rift sits at grade under the trapdoor, **not** on a deck: a deck needs stairs, and
stairs would be a chokepoint.

Verified: all four gates path to the Rift at 25m each (G4 wants ≥18m), the Rift cell
stays unblocked, 698 of 784 tiles are buildable, and every §11 guarantee the other
three sites are held to passes unchanged. It is the first site with **four** gates from
round one and **no chalk at all** — which means `siteCanAnswer` bars a Lamplight Wisp
here, since it needs `sigil ≥ 4`. That is accidentally correct: the Wisp's answer on
this map is the salt ring, and the salt ring is not implemented, so refusing the Wisp
is honest until it is.

#### The question is still open, and the measurement failed

An attempt to answer §13 open question 1 headlessly — same money, same ring-the-Rift
build, player parked, across all four sites — **did not work, and is not reported as
though it did.** The tell was Undertown, a two-lane map, scoring *worse* than the
pinchless one; and quadrupling the budget barely moved any map. Both say the probe was
measuring the shape of one scripted build rather than the maps, so it was deleted
rather than kept as a misleading number.

The doc's own criterion needs a player: *"if a competent player's round-12 clear rate
here is more than one round worse than on Map 02"*. **That is a playtest, and it is the
next thing this map needs.** The pre-specified fix is already written down — add a pair
of low stone walls on the diagonal approaches and accept it as a *four*-pinch map — so
the decision is cheap either way.

Tests: **256** — 236 in the game, 20 in the API.

### 21.14 M1.7 — Map 03, Shaft Nine

**64 × 48 across three levels.** What it invalidates: *the flat build.* Every map
before it was a plan view; this one has a Y axis and the crowd uses it. Rotation is now
Boot Hill 1–3 → Undertown 4–7 → **Shaft Nine 8–11** → the Crossroads 12+.

**The heights are shifted, deliberately.** MAPS §6 draws the gallery at 0m and the
stope at −6m; the engine cannot, because `groundHeight` starts at 0 and returns the
highest box top at or below the query — **0 is the floor of the world**. So the map is
lifted 6m: stope 0, gallery +6, catwalks +11. Every relative height the design depends
on survives, and nothing a player could perceive changes.

**It is 2.5D but planar for pathing**, which is what makes a single 2D flow field
*exact* here rather than an approximation: the gallery (z 6–30) and the stope (z 30–46)
are at different heights and do not overlap in plan, joined only by the haulage ramp.
§6 offered two options — a field per level with link cells, or non-navigable chutes —
and called the second "cheaper, correct for this map". The geometry satisfies it
without a special case. The catwalks *do* overlap the gallery, and they are the
exception that proves it: they are the player's, enemies never path onto them.

**The chutes are the signature verb.** Three one-way drops in the lip, implemented as
a new `navBlock` region — the field refuses to route through them, and *nothing
physical is there*, so a body the player Boots through one falls 6m onto whatever is
built below. It only works because the hole is a hole to physics and a wall to
pathing. A `Box` would have stopped the body as well as the path.

Verified: all three gates reach the Rift, and G3 lands at **36.7m** against the doc's
stated 36m. Heights read correctly at gallery, stope and catwalk. The chute cells are
`blocked = 1` with no geometry behind them.

**Two engine additions**, both small and both forced by the map: `stepsZ` (the haulage
ramp descends south, and `steps` only walked X) and `EnvSlotDef.y` — a mine cart sits
*on* the rail, and the default hoist height put both carts at 14.2m, hanging from the
catwalk 5m above the track.

**One bug caught, and it is the third time this arithmetic has bitten.** The rib's
winzes were authored at 2m. `bakeBlocked` inflates every wall by the agent radius and
marks whole cells, so a 2m gap loses a cell to each side and seals outright — G2 baked
with `dist = Infinity` and could never reach the Rift. Widened to 4m. This is the same
failure as Boot Hill's orchard gap (§21.7) and Undertown's plaza mouths: **a gap
authored below ~3m does not survive the bake**, and it is worth stating as a rule
rather than rediscovering per map.

**Deferred, and named:** the Cage (G4) is absent. It is §11 guarantee 4's second
authored break, and §6 says its mitigation "must ship with it" — three seconds of
visible descent, winch audio starting 1.5s earlier. A spawn point 12.6m from the Rift
*without* that telegraph is precisely what §8 forbids, so it waits for the descent
rather than shipping as an ordinary very-close gate. The mine carts fire the generic
radius one-shot rather than §6's 60m line down the track.

Tests: **264** — 244 in the game, 20 in the API.

### 21.15 M1.8 — walls are squares, and they sit on the grid

An authored ideology, applied to every map: **a wall occupies whole tiles and never
straddles two.**

This is not tidiness, it is the end of a bug. `bakeBlocked` inflates every wall by the
agent radius and marks whole nav cells, so a wall sitting *between* grid lines eats a
cell either side of itself and a 2m gap seals outright. That cost three separate
debugging sessions — Boot Hill's orchard gap, Undertown's plaza mouths, and Shaft
Nine's winzes, where G2 baked with `dist = Infinity`. Each fix was "widen the gap",
which treats the symptom. Tile-aligned walls make it structural: walls are tiles, so
gaps are tiles, and the whole rule collapses to **"a gap is at least 2 tiles"**.

New kit: `wall()`, `slab()` (both quantised) and `hazard()`. Migration is complete on
the four sites this side owns — Boot Hill 10/10, Hollow Creek 9/9, the Crossroads
11/11, Shaft Nine 17/17. `undertown.ts` is authored in parallel and is exempted by
name in the test, as a **migration marker rather than a permanent exemption**.

#### Water, lava, and ground that is not a wall

`BOX.hazard`: flat (2cm), impassable, unbuildable, and blocking **neither sight nor
shots**. That combination is the whole point — an open map with water in it still reads
as open, and you can fight across a channel you cannot walk over. Collision applies
only near the ground, so a **launched body clears one**, which makes a Powder Plate
across a flooded cut something to build rather than an invisible wall.

Three authored, each doing a different job: Hollow Creek finally has a *creek* (it
narrows the northern approach without adding a wall), the Crossroads gets a flooded
trough (an edge to anchor a build against, on the map whose argument is that there is
nothing to hold), and Shaft Nine's stope has a sump under the western chutes, so a body
Booted down one lands in water rather than on open floor.

#### A corridor a barricade can tunnel — and why two tiles is not one

Reported from play: *"on the right side of map, there's 2 squares, both say that would
seal the way through."*

The message was true. Boot Hill's southern loop — the route bodies take once the pinch
is braced — was exactly **two tiles**, and **a two-tile corridor cannot be tunnelled at
all.** A blockade is one tile wide and pads to 2.9m by the agent radius, so in a 4m
corridor it leaves nothing: every tile of it refuses, correctly, and the player is left
staring at open ground they cannot build on. The first legal move on the map made the
only remaining route unbuildable end to end.

**Three is the minimum**, and it is the number where tunnelling starts working: the
outer two tiles accept a brace and only the middle seals, which is exactly the zigzag
the trap exists to build. Boot Hill's flank wall moved two tiles north to give its loop
three, and the refusal count after bracing the pinch fell from **15 tiles to 1**.

The guarantee was wrong too — it asserted ≥2, which is precisely the width that fails —
and is now ≥3, alongside an operational test that reproduces the report directly:
**brace the first legal tile, then require that somewhere on the map another brace is
still legal.** A map that answers "nowhere" has stopped being playable with the trap
that shapes paths.

#### Saying why, instead of only saying no

The same report exposed a plainer failure: a red ghost is silent. "You cannot build
here", "you armed a roof trap" and "you are broke" look identical from behind a
crosshair, and the first thing this bug needed was for the game to distinguish them.
The crosshair now names the refusal — `AIM AT A ROOF BEAM`, `NOT OPEN GROUND`,
`SOMETHING IS ALREADY THERE`, `NOT ENOUGH SCRAP`, `THAT WOULD SEAL THE LAST WAY
THROUGH` — which is what turned an unreproducible report into a two-line diagnosis.

#### What the migration broke, and what it exposed

Four regressions, all the same arithmetic in different clothes, all caught by tests
that already existed: **two gates ended up inside their own walls** (a tile-thick
perimeter moved inward past the spawn point), and **two southern loops sealed** — Boot
Hill's and Hollow Creek's, where a 2m flank wall plus padding left no passable cell
before the perimeter. The loops were load-bearing on both maps; the fix was moving the
flank two tiles north, not widening anything.

**And one genuine bug in the blockade rule.** `wouldSealLane`'s reachability flood was
**4-connected while `bakeDistance` is 8-connected**, so a cell reachable only on a
diagonal looked already-unreachable to the preview — which then skipped that gate and
approved a blockade that cut it off. On Boot Hill, 64 individually legal placements
sealed a gate one at a time.

It was caught by the test written for exactly this in §21.9 — *"the preview and the
real thing have to give the same answer, or the ghost turns green on a placement the
command system then refuses"* — and it is the same class of lie as a ghost path drawn
by different code than the enemies steer by. A preview must walk the same graph as the
thing it previews.

Tests: **297** — 277 in the game, 20 in the API.

**Then the rest of M3:** the chunk cut and the graph generator with its 5,000-seed
validator. Four of the five anchor sites now exist (01, 02, 03, 04) — which is the
chunk library §11 wants to cut from, except §10 says "author the map, play it, **then**
cut it", and three of the four have never been played.

---

## 22. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | **Art scope swallows the project** — still the #1 risk even with AI help (§17.12: ~12 weeks) | **High** | **High** | AI for volume work (props, variants, mocap); one shared humanoid base + rig instead of 8 characters; trim sheets + combinatorial chunks; `budget_check` enforcing limits; the hatch shader forgiving imperfect textures; grey-box first and *always playable*; a hard rule that no new enemy starts until the previous one is in-engine and animated |
| R2 | Fun isn't there after M3 | Medium | High | M0–M3 exists precisely to answer this cheaply, in grey-box, before art commitment. If wave 5 isn't fun with 3 traps and a revolver, more content won't fix it |
| R3 | Perf collapse at 200 enemies | Medium | High | VAT instancing designed in from the start (not retrofitted); blob shadows; flow fields instead of A\*; per-system profiler from M1; the perf regression test in CI from M1 |
| R4 | Shader-compile stutter on first encounter | **High** (it always happens) | Medium | Mandatory `compileAsync` warm-up of every material/VFX variant during load; pool pre-warm; verified with a "first spawn of each type" perf test |
| R5 | Determinism drift breaks replays | Medium | Medium | State hashing from M1; golden replay fixtures in CI; ESLint bans on `Date.now`/`Math.random` in `sim/**`; own `sin`/`cos`; Rapier kept non-authoritative |
| R6 | Download size makes it unplayable on ordinary connections | Medium | Medium | The §17.11 budget table with per-bundle ceilings enforced at build; ETC1S/UASTC; act-level streaming; ≤8MB to first playable |
| R7 | Procgen produces boring or unfair sites | Medium | High | Hand-authored chunks (the *interesting* work is human); graph validation before geometry; the §11 guarantee list; 5,000-seed CI test; a curated fallback layout per act |
| R8 | Safari/iOS WebGL2 quirks | Medium | Low–Med | Test on real Safari from M4, not at M9; KTX2 transcoder verified on device; no reliance on timer queries for correctness; MSAA fallback where float targets misbehave |
| R9 | Scope creep into co-op | Medium | High | §13 is the *ceiling* of co-op investment for v1: contract only, no transport, no lobby, no UI. Written down so it's a conscious violation to exceed |
| R10 | Blender→engine iteration friction kills momentum | Medium | Medium | `npm run art:one <asset>` under 15 seconds is a **milestone exit criterion**, not a nice-to-have. Slow iteration is the most reliable way to stop making art |
| R11 | Portfolio build entanglement (game breaks the site build) | Low | High | Separate `package.json` and `node_modules`; game build runs *after* the CRA build; a CI job asserting the portfolio still builds if `game/` fails; the game never imports from `src/` and vice versa |
| R12 | Memory ceiling on 8GB/integrated machines | Medium | Medium | Texture memory budget per tier; dispose kits on act transition (`.dispose()` on geometries/materials/textures — three leaks aggressively otherwise); heap high-water logging in dev |
| R13 | Vercel function cap hit by a future project | Low | Medium | The game uses exactly **one** function via the `[action]` dispatcher; documented here so the next project knows the count is 6/12 |
| R14 | Motivation decay on a 20-week solo project | **High** | High | Milestones ordered so something is *playable* from week 1 and stays playable every week; the attract-mode capture gives shareable progress at any point; the case study is a deliverable even if the game isn't finished |
| R15 | **AI-assembled art looks incoherent** — the characteristic failure of this pipeline | **High** | **High** | §17.9 is the whole answer: win cohesion in 2D concept sheets with one fixed style suffix, always image→3D never text→3D, mechanical palette-lock at import, de-light everything, one shader for every asset, one detail-frequency budget, and a "shelf" scene reviewed every session |
| R16 | **AI tool churn / licence change** — a tool you depend on changes terms, pricing, or disappears mid-project | Medium | Medium | `art/prompts.jsonl` + `art/audio/prompts.jsonl` record model, prompt and seed for every generated asset, so anything can be regenerated elsewhere. Prefer license-clean local models (Hunyuan3D, TRELLIS, ACE-Step, Stable Audio Open) for anything destined for a public trailer. Keep raw generations in `art/gen/` forever — re-downloading is not always possible |
| R17 | AI provenance questions if the game ever goes public | Low (private) → Medium (public) | Medium | A `CREDITS.md` listing every tool and model; verify commercial terms before any public trailer or case-study footage; note MusicGen's weights are non-commercial. Fine for a private, unlinked game — check before publishing |
| R18 | **Assets can't reach production** — Vercel can't run Blender, so `game/public/assets/` is not a build artifact | **High if unplanned** | High | §18.4: object storage (R2 / Vercel Blob) + the content-hashed manifest, uploaded by `npm run art`. Decide at M4, not at M10. Avoid Git LFS specifically — Vercel's clone doesn't reliably fetch LFS objects |
| R19 | Open route invites score spoofing or endpoint abuse (no password, §18.2) | Medium | Low | §18.3: per-IP rate limits, payload caps, `build_hash` pinning, server-side plausibility bounds, replay-required submissions, soft-delete. Worst realistic case is a junk leaderboard row you delete |
| R20 | **Dev-machine bias** — an RTX 3070 is roughly **4–6× a typical integrated GPU**, so the game will feel fine to you and stutter for everyone else. You will not *notice* a perf regression until very late | **High** | **High** | (1) **Scale the dev HUD's budget**: the §14.1 target of ≤10ms GPU on a median machine is ≈**2–3ms on your 3070** — put the red line at 3ms, not 10ms, and treat that as the real ceiling. (2) Default dev builds to the **Low** tier so you look at the worst case daily; switch to High only to check the look. (3) Test on a genuine iGPU laptop at every milestone, not at M9. (4) Keep the CI perf test (headless sim ms/tick) as the objective backstop, since it's CPU-bound and machine-relative |
| R21 | **No Blender experience** — the plan needs modelling, UVs and baking, and rigging would need months | **Certain** | **High** | §17.0: (1) route rigging and animation entirely through **Mixamo**; (2) Path A code-generated environments so the kit needs no Blender at all until you choose otherwise; (3) scope Blender learning to four concrete tasks (~2 weeks) rather than "learn Blender"; (4) the decision is **deferrable by 8 weeks** — M0–M3 needs grey-box only, so the game gets proven fun before any art skill is required |
| R22 | **Single point of failure on Mixamo** — a free Adobe service the whole character pipeline now depends on | Low | **High** | Export and **archive every rigged FBX and every clip locally the moment you get them** — offline copies keep working regardless of the service. Free fallbacks if it ever disappears: **AccuRIG** (auto-rig) + CC0 animation sets (Quaternius, Kenney) + Blender's Rigify |
| R23 | **Cohesion collapse from maximally heterogeneous sources** — CC0 packs + AI generations + code-generated geometry in one scene | **High** | **High** | §17.9 becomes mandatory rather than advisory: palette-lock every albedo, de-light everything, one shader for all of it, one detail-frequency budget, and review the "shelf" scene every session. Budget **1.5 weeks** for the cohesion pass (§17.12) — it is the most under-estimated task in the whole plan |

---

## 23. Decisions log & remaining questions

### 23.1 Resolved (2026-08-06)

The ten open questions from the first draft are all closed. Recording the
answers, because the *reasons* are what future-you will need:

| # | Question | Decision |
| --- | --- | --- |
| 1 | Name | **GALLOWS HYMN**, more gothic than the original *Bone Orchard*, which survives as the in-world graveyard. Route `/gallows-hymn`, app at `/hymn/` |
| 2 | Audio sourcing | **Generate it ourselves** with AI, then master it properly (§16.4). Cue sheet first, dry/close/mono prompts, layered comping, a real loudness spec, and a prompt ledger so anything can be regenerated |
| 3 | Art method | **AI-assisted, hand-finished** (§17). Art happens *after* the grey-box game is fun. Kits and the humanoid base are hand work; props, variants, textures and mocap are AI |
| 4 | Access gate | **No password.** Unlinked + `noindex` only; the route is a launcher, not a gate. The `/dashboard`-style IP allowlist is repurposed to unlock dev tools (§18.2) |
| 5 | Leaderboard | **Global, all players.** Four small boards, replay-backed, name + local key, no accounts. Rate-limited and plausibility-checked because the route is open (§18.3) |
| 6 | Humanoid enemies | **Required by the theming**, so: one shared humanoid base mesh + one rig, 8 enemies as sculpt/texture/attachment variants (§17.5). Cheaper *and* more cohesive than generating eight characters |
| 7 | Art source versioning | Version the **recipes, not the binaries**: `art/` stays out of the repo, `prompts.jsonl` and `cues.csv` stay in it, built assets go to object storage. **Not Git LFS** — Vercel's clone doesn't reliably fetch LFS objects (§18.4) |
| 8 | Case study | **After ship** (M11). But capture screenshots, GIFs and replays throughout — free during development, impossible to reconstruct later |
| 9 | Camera | **Full body, OMD framing** — 3.4m boom, 1.85m height, 8° down-angle, 0.35m shoulder offset (§7). Costs the full 28-clip animation set; worth it |
| 10 | Renderer | **WebGL2 for v1**, behind a thin backend seam so a WebGPU or custom path can be added later without touching gameplay (§14.7) |
| 11 | Dev machine | **RTX 3070 · 8GB VRAM · 32GB RAM · Ryzen 5 5600X** (measured, not assumed). Consequences: 2D concept + texture generation runs **locally and free**, mesh generation and audio go to the cloud (§17.12), and — importantly — the dev machine is far faster than the median player's, so perf budgets need scaling (§22 R20) |

| 12 | Budget | **$0.** Every tool is free (§17.0, Appendix A.2). If money ever appears, the order is: a music generator (~$10/mo) → Quad Remesher (~$109) → nothing else is close |
| 13 | Blender experience | **None.** So rigging and animation route entirely through **Mixamo**, environments default to **code-generated geometry** (Path A), and Blender learning is scoped to four concrete tasks over ~2 weeks (§17.0). Character Creator 4 and Auto-Rig Pro are **out** — MakeHuman/MPFB2 or a CC0 rigged base instead |
| 14 | **Art style — REVERSED** | **Stylized and cartoony, OMD-style** (§2, §17.1). The first draft explicitly *rejected* "the cartoon tone" and specified a photoreal-leaning reference stack (*Blood Meridian*, *Hunt: Showdown* material honesty) under a cross-hatch/woodcut shader. That was wrong on three counts and the reversal is deliberate: cartoony is what makes 40-bodies-on-screen legible (pillar #2), what makes $0/no-Blender read as *intentional* rather than *failed* (§17.0), and what makes Path A's code-generated geometry look correct rather than like programmer art. **Only the rendering language changed — the tone did not.** The world stays laconic, grim and free of winking (§3); the shader and the silhouettes got chunkier. Shader model accordingly moved from "PBR-lite + hatch" to **banded toon + inverted-hull outline** |
| 15 | Trap assets | **Code-authored geometry, not modelled** — the 23 traps are built as parameterized `BufferGeometry` in `game/src/render/models/traps.ts`, merged one-per-trap with baked per-part vertex colours. Reasons: traps are mechanical (exact pivots for moving parts), they're the assets players stare at longest so parametric tuning beats re-exporting, they live next to their `TrapDef` as reviewable text, and it removes 23 assets from the §17.12 art budget. This is Path A extended from architecture to props, and it upgrades the case-study claim to "the world *and* every trap are generated from code" |
| 16 | **Wall traps — placement is a first-class system** | **Yes, and it is not optional.** The catalog always listed six wall and four ceiling traps, but M0.5 shipped floor-only placement and `TrapDef` had no surface field, so 10 of 23 traps were unreachable. Making them buildable is a redesign of placement, not a new trap: slots become *oriented patches* carrying an outward normal and a height band; targeting moves from grid-snap to a camera ray resolved against slots; sim area tests split into radius/cone/column; and the reach preview has to project a wall trap's cone **onto the floor**, since its effect area is nowhere near its mount point. Forced by the roster rather than chosen: the Marshal's exclusive Hex Lantern is wall-mounted and the Preacher's Church Bell is ceiling-mounted, so floor-only play breaks half the archetypes — and the Rattler's only counter is wall + ceiling coverage. Full spec in §7.1; the map-side contract is G7 in `GALLOWS_HYMN_MAPS.md` |
| 17 | **Hotbar: slot 1 is the gun, and icons are rendered from the traps themselves** | **Two fixes to one row.** (a) M0.5 bound two different mental categories to one hotbar — five things you *place* on `1`–`5`, one thing you *hold* behind `Q` — so "how do I shoot again" had a different answer depending on context. The revolver moves to **slot 1** and traps to `2`–`6`: the hotbar becomes *everything that can be in your hands*, and one always-safe key returns you to shooting. `Q` stays as an alias. (b) Text glyphs do not tell a new player what a Stampede Post is, but the traps must not be hand-drawn either — decision 15 already makes each one a parameterized `BufferGeometry`, so icons are **rendered from that same mesh** at load into an offscreen atlas. A drawn icon drifts the moment a trap is retuned; a generated one cannot, costs nothing from the §17.12 art budget, and extends "the world and every trap are generated from code" to the interface. See §7 |
| 18 | **Trap footprints are contained and tested** | **Geometry is contained; effect is not.** Traps were overflowing their box by ~2× — a 1 m placement cell against a 0.96 m-radius (1.92 m) part in `render/models/traps.ts` — so placed neighbours interpenetrated and wall-adjacent traps hung through geometry. Effect *radius* may spill freely (overlapping areas of effect is what §6 combos are made of); the *mesh* may not, because the player reasons about placement by looking at objects. Every `TrapDef` declares a `footprint`, and a sim test measures each merged trap geometry's XZ bounds against the placement cell rather than trusting the eye — same posture `budget_check.mjs` takes with art. See §7.2 |
| 19 | **Two grids: nav 1 m, placement 2 m** | **Split them.** `level.cell` was serving both the Dijkstra flow field and the trap-placement snap, which is why "make the boxes bigger" looked like a one-constant change and was not: raising it coarsens pathing for 220 units, moves every §11 guarantee (all computed in cells), and invalidates the G7 census (Boot Hill ~620 floor cells → ~155). The two numbers want opposite things — pathing wants fine, placement wants coarse — and only shared a variable by accident. Nav stays 1.0 m; placement becomes 2.0 m, an **integer multiple** so one placement box is exactly 2×2 nav cells and a box is legal only if every nav cell in it is. 2 m clears the measured 1.92 m worst-case trap with margin. See §7.2 |
| 20 | **Weapons carry two abilities; combos drive score, Ash and trap damage** | Four linked changes, recorded together because they only make sense as a set. (a) **Two abilities per weapon on `Q`/`E`** (§7.3), replacing the one-special-per-character sketch — each archetype already had exactly one signature weapon, so the two lists were the same list; folding them halves the balancing surface and makes abilities travel with a purchased weapon. Both keys were occupied: `Q`'s build toggle became redundant under decision 17, and The Boot keeps middle-mouse plus a new `V`. (b) **Tally is dominated by combo hands**, not flat kill points — you cannot climb by shooting well. (c) **Ash = `floor(Tally/1000) × (1 + highestRound/20)`**, spendable on weapons at 400–900, roughly 10–25 good runs; steep on purpose, and since Tally comes from hands the only fast route is kill-box skill. (d) **Enemy HP scales in two regimes** — `+11%`/round to 30, `+18%` after — because the body count caps at 90 around round 38 and an endless game then stops escalating. This partly reverses §4's original "wider, not spongier" argument, which was right *until the cap*; the sponge risk is mitigated by the open hand granting up to `×1.6` **trap** damage, so the player's answer scales with the same skill the score measures |

### 23.2 Deferred decisions

Ordered by impact. **None of these block M0**, and the first one is deliberately
deferred — you'll answer it better with a working prototype in front of you.

1. **⏳ Path A (code-generated environments) or Path B (hand-built Blender kit)?**
   *Decide at M4, around week 8 — not now.* You need grey-box geometry for M0–M3
   regardless, so building it as parameterized, art-directable geometry costs
   nothing extra and may simply turn out to be the final look. The chunk format
   (§11) doesn't care where a chunk's geometry came from, so switching later wastes
   nothing. What to judge it on at M4: does one code-generated room, under the
   final hatch shader and lighting, look *deliberate*? If yes, ship Path A and
   spend the two Blender weeks on props instead. If no, learn Blender then — the
   curve is short and the game is already fun by that point.
2. **Object storage: Cloudflare R2 or Vercel Blob?** R2 if you already have a
   Cloudflare account (zero egress fees); Vercel Blob if you'd rather keep
   everything on one dashboard. Needs deciding by M4 so the manifest carries the
   right base URL from the start.
3. **Are you voicing anything yourself?** A few real grunts and breaths from you
   would outclass any TTS for the hero, and it's twenty minutes of work with a
   phone. Bosses should stay synthetic — the Choirmaster *should* sound wrong.
4. **Should attract mode come early?** It's scheduled at M10, but the machinery
   (deterministic replay + cinematic camera) exists from M1, and building it at
   M4 would give you a shareable 20-second clip of progress at every milestone
   after that. Cheap, and a real hedge against R14 (motivation decay).
5. **Display names on an open leaderboard** — profanity filter plus your
   soft-delete is my assumption. Want anything stronger (approval queue,
   name-change cooldown), or is "I'll delete anything stupid" fine at this scale?

---

## Appendix A — dependency ledger with verified versions

Versions below were checked against npm at plan time (2026-08-06). The **portfolio's
own dependency tree does not change** — everything here lives in `game/package.json`.

### Game runtime

| Package | Version | Why |
| --- | --- | --- |
| `three` | **0.185.1** | Renderer. Has `compileAsync`, `BatchedMesh`, modern tonemapping |
| `@types/three` | 0.185.4 | Match the runtime version exactly; mismatches are a real time sink |
| `bitecs` | **0.3.40** (pin) | SoA ECS, deterministic iteration, zero-alloc. **0.4.0 is an API rewrite — do not adopt mid-project** |
| `pure-rand` | 8.4.2 | Seeded xoroshiro128+ with jumpable streams (§13) |
| `recast-navigation` | 0.43.1 | Navmesh bake in a worker (`@recast-navigation/core` + `/generators`) |
| `three-mesh-bvh` | 0.9.14 | Static-world raycasts, capsule sweeps, LOS, decal projection |
| `@dimforge/rapier3d-compat` | 0.19.3 | **Cosmetic physics only.** `-compat` inlines the WASM as base64 → no loader config |
| `postprocessing` | 6.39.4 | Standalone effect composer (no R3F dependency) |
| `comlink` | 4.4.2 | Ergonomic worker RPC without hand-rolled message plumbing |
| `detect-gpu` | 5.0.70 | Initial quality tier guess |
| `react` / `react-dom` | 19.x | Menus and HUD **only**. Game-side React is independent of the portfolio's React 18 |
| `zustand` | 5.0.14 | Snapshot store bridging sim events → React. Selector-based, so the HUD re-renders on change, not per frame |

### Game build & tooling

| Package | Version | Why |
| --- | --- | --- |
| `vite` | 8.2.0 | Workers, WASM, top-level await, GLSL, content hashing — all first-class |
| `typescript` | 7.0.2 | The sim is where types earn their keep |
| `vite-plugin-glsl` | 1.6.1 | `#include` in shaders |
| `tweakpane` | 4.0.5 | Dev tuning panel |
| `stats-gl` | 4.2.3 | GPU/CPU frame stats |
| `@gltf-transform/cli` + `/core` | 4.4.2 | The asset optimizer: meshopt, KTX2, dedup, join, simplify |
| `meshoptimizer` | 1.2.0 | Mesh compression codec (used by the above) |
| Blender | 4.x | All art; headless `bpy` scripting for export |

### Explicitly considered and rejected

| Option | Why not |
| --- | --- |
| `@react-three/fiber` + `drei` + `@react-three/rapier` | Current line (9.7.0 / 10.7.8 / 2.2.0) needs React 19 — fine in the sub-app — but the reconciler in a 220-entity hot loop is the wrong tool. Great for scenes, wrong for a horde game. (Would have been the pick for the "R3F sub-app" option.) |
| Staying in the CRA app | Pins to R3F 8.18 / drei 9.122 (React 18); KTX2/worker/WASM tooling is a fight against webpack; risks the portfolio's build |
| Babylon.js / PlayCanvas | Genuinely good and more batteries-included, but a second large framework that shares nothing with the React skills story, and less control over the frame loop |
| Unity/Godot WASM export | 20–40MB downloads, poor DOM integration, and it stops being a *web* portfolio piece |
| `yuka` (0.7.8) | Nice steering/AI library, but object-oriented and allocating; our utility AI + flow fields are cheaper and deterministic |
| `miniplex` (2.0.0) | Lovely DX, allocates per entity. Would pick it for a 50-entity game |
| `howler` (2.2.4) | No bus compression, per-space convolution, or voice-stealing control |
| RVO local avoidance | Too expensive at 220 agents and too *polite* — a horde should shove |
| Full PBR | Costs more and looks worse than the hatch/ramp shader for heterogeneous AI-sourced textures |
| SharedArrayBuffer | Would need COOP/COEP headers site-wide; transferable `ArrayBuffer`s carry flow fields fine |
| WebGPU in v1 | Every shader would be authored twice (GLSL *and* TSL) before a shader library even exists. §14.7 keeps a clean seam instead, so the port is a later, one-time job |
| Licensed audio libraries (Splice/Artlist) + CC0 | Generic results for a game that needs 180 *specific* sounds; per-cue specificity is exactly what generative audio is good at (§16.4) |
| Git LFS for built assets | Vercel's clone doesn't reliably fetch LFS objects, so pointer files ship instead of assets. Object storage instead (§18.4) |
| Generating the modular kit with AI | Kit pieces are a *system* — grid-true dimensions, matching seams, shared trim UVs. Cleanup costs more than modelling from a cube (§17.2) |
| Text→3D (when an image exists) | Discards your art direction. Always concept in 2D first, then image→3D — that's where cohesion is won (§17.9) |

### A.2 — the content-tooling stack (all free)

Full reasoning and the honest quality gaps are in **§17.0**; this is the install
list. Nothing here costs money.

| # | Tool | For | Notes |
| --- | --- | --- | --- |
| 1 | **Blender** | Import/export, kit modelling, UVs, AO + lightmap bakes | Learn only the 20% in §17.0. OptiX bakes are fast on the 3070 |
| 2 | **Mixamo** (Adobe, free) | **Auto-rigging + the entire animation library** | The single most important tool in the plan — it deletes the rigging skill wall |
| 3 | **ComfyUI** + SDXL / quantized Flux + depth & normal ControlNets | Concept sheets, textures, trim sheets | Runs great in 8GB. Free and unlimited — this is where the 3070 earns its keep |
| 4 | **StableProjectorz** | Projection-painting textures onto meshes | Built for consumer GPUs |
| 5 | **Instant Meshes** (or Blender's **QuadriFlow Remesh**) | Auto quad-retopo of generated meshes | The free stand-in for Quad Remesher |
| 6 | **MakeHuman / MPFB2** | The shared humanoid base mesh | Or a CC0 Quaternius character |
| 7 | **ambientCG** · **Poly Haven** · **Quaternius** · **Kenney** | CC0 textures, HDRIs, meshes, rigged characters | Production-grade and obligation-free |
| 8 | **TripoSR** / **Stable Fast 3D** (local) + **Meshy**/**Tripo**/**Sloyd** free tiers | Prop meshes | Local for blockouts and volume; ration free-tier credits for the ~30 props that matter. **Check free-tier licence terms before any public trailer** |
| 9 | **Waveform Free** (or **LMMS**) + **Audacity** | The DAW and quick edits | Waveform Free is a real unlimited-track DAW |
| 10 | **ElevenLabs free tier** + **Freesound** (CC0) + local **Stable Audio Open** / **MusicGen medium** / **ACE-Step** | SFX, music, voice | Ration credits to the ~30 priority sounds (§16.5); Freesound covers the tail |
| 11 | **Demucs** · **Matchering** | Stem separation, reference mastering | Free, and no quality gap vs. paid |
| 12 | **RealityScan** (phone) | Photogrammetry of real weathered wood and iron | The best free source of authentic western surface material |
| 13 | **Rokoko Video** / **Plask** / **Cascadeur** free tiers | *Optional later upgrade:* phone mocap + physics-assisted cleanup | Explicitly off the critical path (§17.6) |

---

## Appendix B — repo layout

```
portfolio/
├─ GALLOWS_HYMN.md              ← this document (source of truth)
├─ GALLOWS_HYMN_MAPS.md         ← the five anchor sites + the surface census (§11)
├─ CREDITS.md                   ← every AI tool/model used (§22 R17)
├─ src/Pages/GallowsHymn/       ← the launcher — no gate (portfolio React 18)
│   ├─ GallowsHymnLauncher.jsx  ← sign, title, capability check, .gh-* CSS
│   └─ GallowsHymnLauncher.css
├─ api/
│   ├─ game/[action].js         ← ONE function (6/12 on Hobby)
│   └─ _lib/
│       ├─ game-auth.js  game-db.js  game-ratelimit.js
│       └─ handlers/game-{access,profile,run,leaderboard,replay}.js
├─ art/                         ← GITIGNORED. Sources live in cloud storage (§18.4)
│   ├─ kits/ chars/ traps/ props/ textures/ audio/
│   ├─ gen/                     ← raw AI output, pre-cleanup. Never shipped, never deleted
│   └─ README.md                ← where the real sources live + how to get them
├─ art-recipes/                 ← COMMITTED (small, text, reviewable)
│   ├─ prompts.jsonl            ← every 3D/texture generation: tool, prompt, seed
│   ├─ audio-prompts.jsonl      ← same for audio
│   └─ cues.csv                 ← the audio cue sheet (§16.5)
├─ pipeline/                    ← Blender/AI → browser automation
│   ├─ export.py  normalize.py
│   ├─ palette_lock.mjs  delight.mjs  bake_vat.mjs
│   ├─ optimize.mjs  budget_check.mjs  manifest.mjs
│   └─ upload.mjs               ← push optimized assets to R2/Blob (§18.4)
└─ game/                        ← the Vite sub-app (own package.json / node_modules)
    ├─ index.html
    ├─ vite.config.ts           ← base:'/hymn/', outDir:'../build/hymn'
    ├─ content/                 ← traps, enemies, relics, hexes, chunks, waves, balance
    ├─ src/
    │   ├─ sim/                 ← PURE. no three, no DOM, no React, no wall clock
    │   │   ├─ world.ts  components.ts  systems/*.ts
    │   │   ├─ math.ts          ← own sin/cos LUT for cross-engine determinism
    │   │   ├─ rng.ts           ← pure-rand streams
    │   │   ├─ commands.ts  replay.ts  hash.ts
    │   │   └─ content/         ← typed loaders + validators
    │   ├─ host/                ← rAF loop, accumulator, input sampling, lifecycle
    │   ├─ render/
    │   │   ├─ backend/         ← types.ts · webgl2/ (v1) · webgpu/ (EMPTY, §14.7)
    │   │   ├─ scene/           ← backend-agnostic draw intents
    │   │   ├─ materials/       ← defs/ (data) · glsl/ (v1) · tsl/ (EMPTY)
    │   │   ├─ vat/  vfx/  post/  camera/
    │   ├─ audio/               ← Web Audio graph, voice pool, music stems, IRs
    │   ├─ assets/              ← manifest loader, streaming, remote base URL
    │   ├─ workers/             ← nav.worker.ts, gen.worker.ts
    │   ├─ ui/                  ← React 19: title, coffin, HUD, offers, settings, pause
    │   ├─ net/                 ← EMPTY in v1. Where co-op transport would land
    │   └─ dev/                 ← tweakpane panel, overlays, profiler, attract mode
    └─ tests/                   ← node --test: determinism, procgen, combo, content, perf

# NOT in the repo: built assets (glTF/KTX2/audio) — they live in object
# storage and are fetched at runtime via the content-hashed manifest (§18.4),
# because Vercel's build cannot run Blender.
```

**The boundary that makes this whole plan work:** `game/src/sim/` imports nothing
from `render/`, `ui/`, `audio/` or `three`. Enforce it on day one with an ESLint
`no-restricted-imports` rule and a CI check. Everything good in this
document — headless tests, replays, attract mode, leaderboard verification,
future co-op — falls out of that one rule holding.


