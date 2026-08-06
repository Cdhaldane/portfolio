# Character model prompt — GALLOWS HYMN

> Reusable brief for producing **one playable character** as a game-ready asset.
> Run Part A **once** for the whole roster; run Parts B and C **once per
> character**. Every number here is either taken from `GALLOWS_HYMN.md` or read
> off the shipped M0 code (`game/src/sim/tuning.ts`, `game/src/render/palette.ts`),
> so the model that comes out of this fits the game that already exists.

**Prerequisite:** art happens *after* the grey-box game is fun (§21, M4). This
document is written now so the roster design is settled and the first run through
the pipeline has a target; it is not a signal to start modelling.

---

## 0. The architecture decision, before any prompting

Four playable characters do **not** mean four characters' worth of work. Apply the
§17.5 trick to the hero exactly as it's applied to the horde:

```
        ┌──────────────────────────────────────────────┐
        │  SK_HeroBase   ·  ~9,000 tris  ·  ONE rig    │
        │  ONE UV layout · ONE 28-clip animation set   │
        │  neutral body, bare head, boots, trousers,   │
        │  shirt — no hat, no coat, no weapon          │
        └───────────────┬──────────────────────────────┘
                        │ 6 attachment sockets
        ┌───────────────┴──────────────────────────────┐
        │  SM_Kit_Marshal   SM_Kit_Preacher            │
        │  SM_Kit_Prospector  SM_Kit_Undertaker        │
        │  ≤12,000 tris each · hat, coat, rig, gear    │
        └───────────────┬──────────────────────────────┘
                        │ SOCKET_hand_r
        ┌───────────────┴──────────────────────────────┐
        │  SM_Wpn_LeverRifle  SM_Wpn_CoachGun          │
        │  SM_Wpn_HandCannon  SM_Wpn_Absolution        │
        │  ≤3,000 tris each                            │
        └──────────────────────────────────────────────┘
```

Why this is the only sensible shape:

- **One rig means one Mixamo pass and one 28-clip set** (§17.6). Four rigs would
  mean four auto-weight jobs, four retarget passes, and four sets of skinning
  bugs — for a difference the player sees as "a different hat and coat."
- The kit meshes are **static props parented to bones**, not skinned geometry, for
  everything rigid: hat, buckles, holsters, canteen, rifle sling hardware. Only
  the coat needs skinning, and it reuses the base's weights via a data transfer.
- Character identity therefore comes from **prop modelling**, which is the
  beginner-friendly kind of Blender work (§17.0), not from character modelling,
  which is the kind that takes months.

Budget split against the §17.7 hero allowance of **24k tris + 3k weapon**:
base 9k · kit ≤12k · 3k headroom · weapon ≤3k separately.

---

## 1. The roster

Four characters. Each gets a **unique weapon** carrying **two abilities on `Q`
and `E`** (§7.3 — they belong to the weapon, so they travel with it when it is
bought), **one passive bonus**, and one exclusive trap. The exclusive-trap column
from §7 is retained unchanged.

> **Abilities belong to the weapon, not the character** (§7.3, decision 20). Each
> archetype has exactly one signature weapon, so the two lists were always the same
> list; they are folded, and the abilities travel with the weapon when it is bought
> with Ash (§10). `Q` is the setup verb, `E` the payoff — never interchangeable.
> §7's weapon/passive/trap assignments are otherwise unchanged.

| | **The Marshal** | **The Preacher** | **The Prospector** | **The Undertaker** |
| --- | --- | --- | --- | --- |
| **Fantasy** | Precision, lanes, discipline | Magic-forward crowd control | Explosives and greed | Minions and attrition |
| **Weapon** | **Long Account** — lever rifle. Hitscan, pierces 3, 45 dmg, 1.4/s, mag 8 | **Benediction** — coach gun. 8 pellets × 12, knockback 5m, 0.9/s, mag 2 | **Assay** — hand cannon. Projectile, 90 in a 3m AoE, 0.7/s, mag 4 | **Twin Sermons** — paired Absolutions. 34 (×2.5 head), 2.5/s, 12 rounds, alternating |
| **Ability `Q`** | **Dead Reckoning** · 24s — paint a 20m lane; for 8s every shot pierces unlimited targets and crits anything inside it | **Peal** · 20s — a bell pulse: stagger + fear for 3s in 7m, and every trap in 7m deals +50% for 4s | **Blasting Charge** · 18s — lob a keg, detonate on command: 100 dmg in 4m, launches 10m up | **Wake** · 30s — every corpse within 8m rises as a Revenant for 15s (cap 4) |
| **Ability `E`** | **Steady** · 14s — brace: no spread, +40% damage, cannot move for 3s | **Scattershot** · 12s — both barrels: 16 pellets, 6m knockback, self-launch 5m back | **Assay Mark** · 16s — tag one enemy: +60% damage from *traps*, triple scrap | **Fan the Hammer** · 10s — empty both cylinders in 1.5s, 12 rounds, no reload cost |
| **Passive** | +25% damage to marked or hexed enemies | Salt regen +100%; hexes cost −20% | +25% scrap from all sources; start each run with +60 | Corpses grant 2 salt; Ash Circle costs −40% |
| **Exclusive trap** | Hex Lantern (starts upgraded) | Church Bell | Powder Plate (starts upgraded) | Ash Circle |
| **Silhouette ID** | Long coat to mid-calf, flat-brim hat, rifle slung across the back, bandolier | Wide flat hat, short cassock over trousers, stole, book chained to the hip | Battered short coat, brimless leather cap with goggles pushed up, pack + kegs, one gloved arm | Tall stovepipe hat, high-collared frock coat to the ankle, twin low holsters, coffin lid on the back |
| **Read from behind** | Rifle diagonal | Stole tails + book | Pack bulk high on the shoulders | Coffin-lid rectangle |
| **Kit accent** | `rust` `#8a4a2b` | `bone` `#c9bfa8` | `lamp` `#ffab5e` | `void` `#0b0a0c` |

**The read-from-behind row is not decoration.** The camera sits 3.4m behind and
1.85m up (`CAMERA` in `tuning.ts`), so the back of the character is what the
player looks at for the entire run. Two of these must be distinguishable as black
shapes from behind at 64px, or the character-select screen is the only place the
choice is ever visible.

**Palette constraint that overrides all four accents:** the Vigil is warm
lamp-orange and deep indigo (§3 faction table). Kit accents differentiate *within*
that band. **No character may use `hex` `#4ff0e0` or `bell` `#9be3ff` anywhere** —
cyan means Choir and "physical traps don't work here," and that contract is the
single biggest readability lever in the game. Differentiate by silhouette and
value, never by hue.

---

## 2. What the camera can actually see (the detail budget)

At 1080p with the shipped camera — boom 3.4m, vertical FOV 75° — the visible frame
height at the character's distance is `2 × 3.4 × tan(37.5°) ≈ 5.2m`. A 1.8m
character therefore occupies **≈370 px**, or about **4.9 mm of surface per pixel**.

Consequences, and they are the difference between 15 minutes and 3 hours per asset:

- Anything under **3 cm** covers fewer than 6 px. **Bake it, never model it** —
  buttons, stitching, buckle tongues, hatband seams, cartridge rims.
- Anything under **1 cm** is invisible. Don't even bake it; it becomes noise the
  toon shader's hard ramp (§17.1) then amplifies.
- **Nothing thinner than 4 cm** as an actual form — the cartoony rule from §17.1.
  Thin geometry is what makes stylized work read as cheap rather than deliberate.
- The features that *do* pay for polygons: hat brim outline, coat hem, shoulder
  line, collar height, the one asymmetric ID element, and the weapon's profile.
- The face gets **no polygons and no rig**. At 370 px the head is ~45 px tall. Paint
  it into the albedo; shade it with the ramp.

---

## 3. Hard specs, all three parts

Non-negotiable, and `pipeline/budget_check.mjs` fails the build on the starred ones
(§17.10).

| Rule | Value | Source |
| --- | --- | --- |
| Unit | 1 Blender unit = 1 metre | §17.7 |
| ★ Height | **exactly 1.800 m**, sole to crown, hat excluded | `PLAYER.height` |
| ★ Eye line | **1.620 m** — the head lands where the sim says it does | `PLAYER.eyeHeight` |
| ★ Body width | fits a **0.80 m** cylinder at chest and hip | `PLAYER.radius` 0.4 |
| Coat flare | may reach **1.00 m** — cosmetic only, never collides | — |
| Step clearance | nothing below **0.35 m** may read as ground-penetrating | `PLAYER.stepOffset` |
| ★ Pivot | origin **between the feet**, feet at Z = 0 | §17.7 |
| ★ Forward | **−Z**; up +Z in Blender, exported **+Y up** | §17.10 |
| ★ Transforms | applied — no non-uniform scale, no negative scale, mirror applied | §17.10 |
| Normals | weighted-normal modifier or custom split normals | §17.7 |
| ★ Tris | base ≤ 9,000 · kit ≤ 12,000 · weapon ≤ 3,000 | §17.7 |
| ★ Materials | **one** per asset; base + all kits share the hero atlas | §17.7 |
| ★ Texel density | **128 px/m** body and kit · **256 px/m** weapon | §17.7 |
| UVs | UV0 only. **No UV1** — characters get no lightmap | §17.7 |
| Textures | `T_hero_alb` (RGB albedo + A mask), `T_hero_nrm` (RG normal + B rough + A AO) | §17.7 |
| ★ Albedo | **de-lit** — no baked shadow, AO, or highlight | §17.9 |
| ★ Palette | locked to the 14 swatches in `render/palette.ts` at strength 0.6 | §17.9 |
| ★ Naming | `SK_HeroBase` · `SM_Kit_<Char>` · `SM_Wpn_<Name>` · `T_*` · `AN_*` | §17.7 |
| Bones | Mixamo standard, **fingers stripped on export**, target ≈60 | §17.6 |
| Topology | quad-dominant; **≥3 edge loops** at shoulder, elbow, wrist, hip, knee, ankle | §17.10 |

---

## 4. Part A — `SK_HeroBase` (run once, shared by all four)

### A.1 Concept pass (2D, local ComfyUI — §17.12)

Generate the sheet before any 3D. A 2D miss costs 20 seconds; a 3D miss costs 25
minutes (§17.9). **Always image→3D, never text→3D.**

```
PROMPT
Orthographic character reference sheet of a lean adult frontier figure, late
1880s, in a strict T-pose: arms straight out horizontally, palms flat and facing
down, fingers separated and not touching, legs straight and hip-width apart,
feet flat and parallel. Bare head, no hat. Plain collarless work shirt, canvas
trousers, worn leather ankle boots, a single belt. No coat, no weapon, no
props, nothing in the hands. Front, side and back views, all three aligned to
the same height guide lines, identical scale, identical pose.
<<STYLE_SUFFIX>>

NEGATIVE
hat, coat, cloak, cape, weapon, gun, holster, props in hands, hands touching
body, A-pose, dynamic pose, foreshortening, perspective, cast shadow, rim light,
dramatic lighting, cyan, teal, turquoise, neon, saturated colour, armour,
fantasy, anime, chibi, text, watermark, logo, signature, background scenery
```

### A.2 Mesh

Two routes; take whichever gets to a clean base faster, they converge at A.3.

- **MakeHuman / MPFB2** (§17.0) — set the height to 1.80 m, lean build, then dress
  it with box-modelled shirt/trousers/boots. Gives correct topology and loops for
  free, which is exactly what the deform zones need.
- **CC0 rigged humanoid** (Quaternius) — retopo to budget, re-UV, keep the loops.
  Quaternius' chunky low-poly read is now a *direct* fit for the cartoony style
  (§17.1), not just an acceptable compromise; verify the height first.

Image→3D generators are the wrong tool here: they produce triangle soup with no
edge loops at the elbows, and it crumples the moment it's skinned (§17). Generation
earns its place on the *kit*, in Part B.

### A.3 Mixamo prerequisites — get these wrong and the auto-rig fails

- **One** combined mesh. No armature, no shape keys, no modifiers unapplied.
- **T-pose**, upright, real-world scale, facing forward.
- Arms horizontal; **hands clear of the hips**; **fingers separated** — Mixamo needs
  to see them to place the hand chain.
- Legs apart, feet flat, no crossing geometry.
- Export **FBX (binary)**, one material.

Upload, place the markers (chin, wrists, elbows, knees, groin), take the rig.

### A.4 Coming back from Mixamo

1. Download the rigged FBX **and every clip you intend to use, immediately** — §22
   R22: the whole character pipeline hangs off one free Adobe service. Archive the
   FBXs locally the moment you have them.
2. Import to Blender; strip finger bones beyond one thumb + a merged 3-finger chain
   per hand (§17.6), targeting ≈60.
3. Add the six sockets as **empties parented to bones**, oriented so a prop's local
   −Z is the muzzle direction:

   ```
   SOCKET_hand_r   right hand   primary weapon
   SOCKET_hand_l   left hand    Twin Sermons' second revolver, the Preacher's book
   SOCKET_back     upper spine  slung rifle, coffin lid
   SOCKET_hip_r    right hip    holster
   SOCKET_hip_l    left hip     holster, canteen, chained book
   SOCKET_head     head         hat
   ```

4. Verify against the clip list (§17.6): idle, idle_alert, walk ×4, run ×4, sprint,
   jump_start/loop/land, slide, aim_idle, fire, fan_fire, reload_start/loop/end,
   boot_kick, melee_1/2, cast_a/b/c, hurt_l/r, death_1/2, place_trap, revive,
   victory, title_pose. Retime to `walkSpeed` 6.5 and `sprintSpeed` 9.5 m/s so the
   feet roughly track the code-driven locomotion; §17.6 already accepts some
   sliding at 3.4m boom.
5. `title_pose` is per-character — it's the character-select and launcher pose, the
   one frame that has to sell the choice. Hand-key these four.

---

## 5. Part B — `SM_Kit_<CHARACTER>` (run once per character)

**This is the parameterized part.** Fill the block, run the pass, repeat four times.

### B.1 Fill this in

```
CHARACTER          = Marshal | Preacher | Prospector | Undertaker
KIT_PIECES         = <from the Silhouette ID row, §1>
READ_FROM_BEHIND   = <from the Read-from-behind row, §1>
ACCENT             = <from the Kit accent row, §1>
SOCKETS_USED       = <subset of the six>
SKINNED_PIECES     = <coat only, normally>
TRI_BUDGET         = 12000
```

### B.2 Concept pass

```
PROMPT
Orthographic character reference sheet, late 1880s American frontier, strict
T-pose matching a 1.8 m figure. <<CHARACTER>>: <<KIT_PIECES>>. Viewed from
front, side and back at identical scale on shared height guides; the back view
must show <<READ_FROM_BEHIND>> clearly. Garments and gear only — the body
beneath is already built. Dominant material tones are worn leather, dry canvas,
oxidised iron and dust, with <<ACCENT>> as the single accent. Flat even lighting,
flat albedo, no shadows.
<<STYLE_SUFFIX>>

NEGATIVE
cyan, teal, turquoise, neon, glow, emissive, saturated colour, armour plate,
fantasy, steampunk brass excess, modern clothing, zippers, anime, chibi,
dynamic pose, perspective, cast shadow, text, watermark, logo, background
```

Iterate here until the **back view** reads. Then, and only then, go to 3D.

### B.3 Mesh

- **Rigid pieces** — hat, buckles, holsters, goggles, canteen, pack, coffin lid,
  book: image→3D in Meshy/Tripo (ration the free-tier credits, §17.0) →
  Instant Meshes or QuadriFlow retopo → normalize → re-UV into the hero atlas.
  These never deform, so generated topology is fine and this is where AI pays.
- **The coat** — box-model it by hand over the base body, then transfer weights from
  the base mesh (`Data Transfer` → vertex groups, nearest face interpolated). Hand
  modelling is faster than fixing a generated coat, and the transfer gives usable
  skinning with zero weight painting.
- Rigid pieces are **parented to bones**, not skinned. Hats to `head`, holsters to
  `hips`, pack to `spine_02`, coffin lid to `spine_03`.
- Delete anything the base body hides under the kit — no geometry inside a closed
  coat.

### B.4 Finish

De-light → palette-lock at 0.6 → bake AO + curvature into the hero atlas slot →
`npm run art:one hero_<character>` and look at it in the shelf scene next to the
other three and next to a Dustkin (§17.9).

---

## 6. Part C — `SM_Wpn_<NAME>` (run once per character)

```
PROMPT
Orthographic three-quarter and side product views of a single <<WEAPON>>, late
1880s, isolated on a neutral 50% grey background. Blued or browned steel with
honest wear at the contact points, oiled walnut furniture, brass only where the
period would actually use brass. Mechanically plausible: the action, the
cartridge and the sights must match the type. Flat even lighting, flat albedo,
no shadows, no hands, no holster, no ammunition scattered around it.
<<STYLE_SUFFIX>>

NEGATIVE
hands, arms, holster, scope, optic, rail, polymer, modern firearm, sci-fi,
engraving excess, ornate filigree, gold plating, cyan, glow, text, watermark,
background scenery
```

| Character | `<<WEAPON>>` | Asset | Notes |
| --- | --- | --- | --- |
| Marshal | lever-action repeating rifle, octagonal barrel, walnut stock, ladder sight | `SM_Wpn_LeverRifle` | Lever must be a separate object — `reload_start/loop/end` animates it |
| Preacher | short double-barrelled coach gun, exposed hammers, cut-down stock | `SM_Wpn_CoachGun` | Barrels break downward; hinge as a child object |
| Prospector | oversized single-shot break-action hand cannon, heavy octagonal barrel | `SM_Wpn_HandCannon` | Reads as an obvious silhouette from behind |
| Undertaker | single-action revolver, 4¾" barrel, worn ivory grip | `SM_Wpn_Absolution` | One mesh, instanced twice; cylinder separate for the fan-fire clip |

Specs: ≤3,000 tris · **256 px/m** · own material and 1024² texture · pivot at the
grip where the socket sits · local **−Z is the muzzle** · moving parts (lever,
cylinder, hammer, break hinge) as separately-pivoted child objects, since they're
animated in code, not in the clip.

---

## 7. The fixed style suffix — never change this mid-project

§17.9's first and most important cohesion mechanism. Paste it verbatim into every
prompt above, record it in `art-recipes/prompts.jsonl`, and **do not edit it once
the first asset ships** — changing it re-styles nothing already made and
un-matches everything still to come.

```
<<STYLE_SUFFIX>>
stylized cartoony game art in the style of Orcs Must Die, western gothic subject,
chunky exaggerated proportions, oversized functional details, bold clean shapes,
thick forms with no thin or fiddly detail, flat blocky colour with hard-edged
shading and high value separation between adjacent parts, limited palette of bone
white, dry dust brown, weathered timber, oxidised rust and dark oxblood with warm
lamp-orange accents, strong readable silhouette, orthographic, flat even studio
lighting, no cast shadows, no rim light, flat albedo, neutral 50 percent grey
background, full body in frame, feet flat, no cyan, no text, no logo, no signature
```

**This replaced a cross-hatched matte-painting suffix** when the art style was
reversed to cartoony (§23.1 decision 14). It was changed before any asset shipped,
which is the only time it may change — see the paragraph above.

---

## 8. Acceptance checklist (per asset)

Nothing enters `art/` until it passes.

- **★ = enforced by `budget_check.mjs`** — it exits non-zero, so the build fails.
- **☆ = partly enforced**; the rest of that line is on you.
- **unmarked = human judgement**, and no tool is coming for it.

Run it with `npm run art:budget <file|dir>`, or let `npm run art` do it as step 4.

- [ ] ☆ 1.800 m sole to crown; fits the 0.80 m cylinder — **eye line 1.620 m is not
      checked**: it needs a rig landmark, not a bounding box, so a skinned asset is
      reported as unverifiable rather than guessed at from height
- [ ] ★ Pivot between the feet, feet at Z = 0, transforms applied, no negative scale
- [ ] ☆ +Y up on export — **−Z forward is not checked**; a hat and a coat look
      identical to a bounding box, and asserting otherwise would be a lie
- [ ] ★ Triangle count within Part A / B / C budget
- [ ] Quad-dominant; ≥3 edge loops at every deform zone
- [ ] ★ Single material; UV0 in the hero atlas at 128 px/m (weapon 256); no UV1
- [ ] ★ Albedo de-lit — measured as low-frequency luminance variation in stops
      (`delight.mjs`'s metric: a de-lit PBR albedo reads 0.02–0.20, a source with
      painted shadow over 0.5)
- [ ] ★ Palette-locked; **zero** `hex` or `bell` cyan anywhere on a Vigil asset —
      the cyan rule is a hard failure, not a warning
- [ ] Silhouette readable as a black shape at 64px — **from behind**, not just front
- [ ] Distinguishable from the other three characters from behind at 64px
- [ ] Detail frequency matches the kit; nothing under 3 cm modelled
- [ ] ★ Naming convention followed
- [ ] Six sockets present, oriented, parented to the right bones
- [ ] Rigid pieces bone-parented, not skinned; coat weights transferred and tested
      on `walk`, `run`, `slide`, `boot_kick`, `death_1`
- [ ] Rigged FBX + every clip archived locally (§22 R22)
- [ ] Prompt, tool, model, seed and settings appended to `art-recipes/prompts.jsonl`

Ledger line format:

```jsonl
{"file":"SM_Kit_Marshal.blend","asset":"kit","character":"marshal","tool":"comfyui","model":"flux1-dev-Q5","prompt":"<full text incl. style suffix>","seed":884201,"settings":{"steps":28,"cfg":3.5,"sampler":"euler"},"date":"2026-08-06","license":"local weights, see CREDITS.md"}
```

---

## 9. Definition of done for the roster

1. `SK_HeroBase` rigged, 28 clips retimed, in-engine, walking on a code-generated
   site at 60fps.
2. Four kits swappable at runtime by socket assignment — proving the whole point of
   the shared-base architecture in one test.
3. Four weapons in `SOCKET_hand_r` with correct muzzle transforms; the hitscan ray
   still originates from the camera per §21.1 note 1, so the weapon is cosmetic and
   must never become the ray origin.
4. Four `title_pose` frames, hand-keyed, driving the character-select screen.
5. The shelf scene shows all four side by side, from behind, under final lighting,
   and they are unmistakable.
6. `npm run art:one hero` completes in **under 15 seconds** (§21 M4 exit criterion,
   §22 R10).
