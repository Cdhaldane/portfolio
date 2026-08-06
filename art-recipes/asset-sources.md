# CC0 asset sources — GALLOWS HYMN

> The registry of every external source allowed into the game. **CC0 only** — no
> attribution clause, no non-commercial clause, no share-alike, nothing that has
> to be tracked through a public web build.
>
> `sources.jsonl` is the machine-readable truth; this file is the reasoning.
> `pipeline/vendor.mjs` fetches, `pipeline/credits.mjs` credits, and
> `sources.lock.json` pins the exact bytes.

**Prerequisite, same as everywhere else in §17:** art happens *after* the
grey-box is fun (§21, M4). This exists so that when M4 arrives the sourcing
decision is already made and reproducible, not so that anyone starts dressing
the game now.

---

## 0. Why the rule is CC0-only and not "free"

"Free" is four different licences wearing one word, and three of them cost
something later:

| What people call free | The actual obligation | Why it is excluded here |
| --- | --- | --- |
| **CC0** | none | ✅ the only thing in this ledger |
| CC-BY | a credit that must survive every build | An unattributed CC-BY asset in a shipped build is a licence breach, not an oversight. One missed credit taints the whole page |
| Royalty-free (Sonniss, Mixamo) | usually fine, but bounded by a EULA that can add clauses | Excluded from the *ledger*; see §5 — some are still worth using, just not automatically |
| Free tier (Meshy, Tripo) | often non-commercial or attribution, per §17.3's own warning | Never enters a public build without a per-asset check |

The game ships as a **web build on a public portfolio**. Every byte is
downloadable by anyone who opens devtools. That is fine under CC0 and merely
survivable under everything else, so the ledger holds the line at CC0 and the
judgement calls happen consciously, outside it.

The second reason is mechanical: **CC0 is the only licence that composes.**
Mixing six CC-BY sources means maintaining six credit lines forever; mixing six
CC0 sources means maintaining nothing. `credits.mjs` still generates the credits,
because the people who gave this away deserve the name-check — but it is a
courtesy the build cannot break.

---

## 1. What is in the ledger

14 sources, ~122 MB, all CC0 1.0. `npm run art:vendor:list` prints this live.

### Characters and animation

| Source | Covers | Fetch |
| --- | --- | --- |
| [Quaternius — Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) | **§17.5 `SK_HumanoidBase`.** 6 rigged humanoid bases, 3 body proportions, retargetable humanoid rig. glTF/FBX/OBJ/Blend | manual |
| [Quaternius — Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) | **§17.6 clip lists.** 120+ clips: 8-way locomotion, jog, sprint, crawl, gun actions, deaths, emotes. Same rig as above | manual |
| [KayKit — Skeletons](https://kaylousberg.itch.io/kaykit-skeletons) | §17.5 undead silhouette study. 4–6 rigged skeletons, 90+ animations, 10+ accessories | manual |

**These two Quaternius packs are the most valuable things in this document, and
not for the obvious reason.** §22 R22 flags that the entire character pipeline
hangs off Mixamo — one free, unmaintained Adobe service that has shipped no
meaningful update since 2015 and has been tightening Creative Cloud coupling.
A CC0 base mesh plus 120 CC0 clips on a retargetable rig is the same capability
with no single point of failure and no terms that can change. Mixamo is still
the better library and still worth using; it is no longer the only floor under
the plan.

### Props, kit and organics

| Source | Covers | Fetch |
| --- | --- | --- |
| [Kenney — Graveyard Kit](https://kenney.nl/assets/graveyard-kit) | Graves, headstones, coffins, iron fences, benches, urns — 90 models | auto |
| [Kenney — Modular Cave Kit](https://kenney.nl/assets/modular-cave-kit) | Mine interiors; proportion reference for the Path A generator | auto |
| [Kenney — Pirate Kit](https://kenney.nl/assets/pirate-kit) | Barrels, crates, rope, lanterns, planking | auto |
| [Kenney — Fantasy Town Kit](https://kenney.nl/assets/fantasy-town-kit) | Timber-frame buildings, boardwalk, roofing | auto |
| [Kenney — Mini Forest](https://kenney.nl/assets/mini-forest) | Dead trees, stumps, scrub | auto |
| [OpenGameArt — Low poly Western Objects](https://opengameart.org/content/low-poly-cc0-western-objects-pack) | The only genuinely *western* CC0 3D pack found | auto |

Mini Forest earns its place for a specific reason: §17.0 Path A says irregular
organics "don't code-generate well," which leaves a hole the TypeScript
generator cannot fill. This fills it for free.

### Textures and lighting

| Source | Palette role (§17.1) | Fetch |
| --- | --- | --- |
| [ambientCG — Metal063](https://ambientcg.com/view?id=Metal063) | `rust` `#8a4a2b` — corroded iron, Company ironwork | auto |
| [ambientCG — WoodFloor064](https://ambientcg.com/view?id=WoodFloor064) | `timber` `#5a4433` / `timber-dark` `#33261c` | auto |
| [ambientCG — Ground107](https://ambientcg.com/view?id=Ground107) | `dust` `#6e6559` — dry earth, ground plane | auto |
| [ambientCG — Rock064](https://ambientcg.com/view?id=Rock064) | `grave` `#3b3a3d` — stone, headstones, cliffs | auto |
| [Poly Haven — Blaubeuren Night](https://polyhaven.com/a/blaubeuren_night) | Night IBL for the crushed-black value structure | auto |

Four textures, not forty. §17.7 wants trim sheets and atlases, so these are
*trim sheet inputs*, not per-asset textures. One per palette role is the point.

---

## 2. Commands

```bash
npm run art:vendor           # fetch everything missing, verify, write the lock
npm run art:vendor:list      # print the ledger, no network
npm run art:vendor:check     # verify local bytes against the lock (offline)
npm run art:credits          # regenerate the block in CREDITS.md
npm run art:credits:check    # fail if CREDITS.md is stale — for CI
```

Useful flags: `--only <id,id>`, `--force`, `--extract`.

Vendoring is step zero of the §17.8 build. Once sources are in `art/`, the whole
chain is one command:

```bash
npm run art                  # delight → palette_lock → optimize → budget → manifest
npm run art:one -- coffin    # single asset; §21 M4 wants this under 15s
npm run art:import -- <file> # report what a fresh generation needs fixed
```

Individual stages are also runnable on their own — `art:budget`, `art:lock`,
`art:delight`, `art:optimize`, `art:manifest` — which is how the vendored packs
above were measured for §3.

**What the script actually guarantees.** Not much, deliberately — but the little
it does is the part that rots silently otherwise:

- **Licence drift is a build failure.** Kenney's download URL carries a content
  hash that changes on every pack revision, so it has to be resolved from the
  page anyway; while there, the resolver asserts the page still reads
  "Creative Commons CC0" and throws if it does not.
- **Integrity is pinned.** Every file gets a sha256 in `sources.lock.json`.
  Poly Haven publishes an md5 per file, so that one is verified against the
  publisher rather than only against our previous fetch.
- **Provenance survives.** The lockfile records the resolved URL, byte count,
  fetch timestamp, and a `licenceEvidence` string saying *how* the CC0 claim was
  checked — including, honestly, "asserted from ledger" where the source exposes
  no machine-readable licence.

The vendored bytes are gitignored. The ledger and lockfile are committed, which
is what makes `pipeline/vendor/` reproducible from a clean clone.

---

## 3. Measured against §17.7, not assumed

Every GLB in the auto-fetched packs, parsed and counted:

| Pack | Models | Tri range | Median | Over 1,500 | Max materials |
| --- | --- | --- | --- | --- | --- |
| Graveyard Kit | 91 | 54 – 1,141 | 256 | **0** | 1 |
| Mini Forest | 22 | 58 – 847 | 266 | **0** | 1 |
| Pirate Kit | 72 | 44 – 2,282 | 286 | 6 | 1 |
| Fantasy Town Kit | 167 | 4 – 1,628 | 96 | 1 | **2** |
| Modular Cave Kit | 40 | 4 – 8,080 | 592 | 13 | 1 |

**392 models, and most of them already pass.** The §17.7 prop budget is
200–1,500 tris with one material per asset; Graveyard Kit and Mini Forest clear
it outright, with a median an order of magnitude under the cap. That is the
finding worth acting on — these are not "starting points that need retopo," they
are assets that pass `budget_check.mjs` as-is.

The exceptions, so nobody discovers them at M4:

- **Modular Cave Kit's 13 heavy models** are cave *modules*, which fall under
  the chunk budget (3k–8k), not the prop budget. 8,080 is at the ceiling, and
  the kit's grid will not match our 0.25m snap / 4m modules — treat it as a
  proportion reference for the Path A generator rather than shipping geometry.
- **One Fantasy Town model carries 2 materials**, which breaks the starred
  single-material rule. One model, one fix.
- Pirate Kit's 6 over-budget models top out at 2,282 — a decimate pass, not a
  retopo.

Every pack uses **one texture image per model** — a shared flat palette atlas.
That is exactly the §17.7 atlas shape, arrived at by accident, and it means the
"re-UV into a shared atlas" friction §17.7 warns about mostly does not apply to
this tier.

---

## 4. Why a grab-bag of six publishers will cohere

Normally this list would be a warning sign: §17 opens by saying what kills a
project like this is heterogeneous assets. It does not apply here, because of
the order of operations in §17.9.

Every texture is **palette-locked to the 14 swatches at strength 0.6 on import**,
then lit by **one shader** — §17.1's banded toon model: a hard 3-band ramp with
a crisp terminator, plus an outline pass. Source hue is destroyed on the way in.
What survives is silhouette, proportion and value, which is why the selection
criterion above is always "does the shape read," never "does the colour match."

Kenney, Quaternius and KayKit share a register — flat-shaded, low-poly, single
palette texture, chunky readable forms — and that register is a *good* fit for a
banded toon shader, not a compromise forced by budget. It is in fact the same
register §17.1 now names as the target (*Orcs Must Die*). None of the games
§17.0 cites look expensive because of asset spend.

---

## 5. What CC0 does not cover — the honest gaps

The ledger cannot fill these, and pretending otherwise is how a plan quietly
fails at M4:

| Gap | Why | Where it actually comes from |
| --- | --- | --- |
| **The four hero characters** | No CC0 western hero exists. The §1 roster — flat-brim hat, stole and chained book, goggles and kegs, stovepipe and coffin lid — is bespoke by definition | `prompts/character-model.md`, Parts A–C |
| **Period weapons** | No CC0 lever rifle, coach gun or hand cannon at usable quality | Part C of the character brief |
| **The 23 traps** | §17.2 calls these hero assets that must telegraph and animate. Nothing generic substitutes | Hand-modelled, per §17.2 |
| **Audio, entirely** | There is no CC0 bulk SFX library comparable to the mesh packs | §16.4 pipeline + the sources below |
| **Western architecture** | Fantasy Town Kit is the closest CC0 kit and it is fantasy | Path A generator (§17.0) |

So the ledger's real scope is **props, textures, lighting, and the character
*base*** — roughly §17.2's biggest-count rows, and none of its hero rows. That is
the right split: it removes the volume work and leaves the work that carries
identity, which is the work worth doing by hand anyway.

### Deliberately excluded, and why

Not in the ledger — usable, but each needs a conscious decision rather than an
automatic fetch:

- **[Sonniss GDC Game Audio Bundle](https://gdc.sonniss.com/)** — 7.47 GB, 347
  WAV, royalty-free, no attribution. Genuinely the best free SFX source there is.
  **Not CC0**, and its licence prohibits AI/ML training — which matters directly,
  because §16.4 runs local audio models. Use the files; never feed them to
  MusicGen or Stable Audio.
- **Mixamo** — still alive, still free, still royalty-free for unlimited
  commercial use. Not CC0, and you may not redistribute the raw clips. Keep
  using it; keep the Quaternius library as the floor (§22 R22 says archive the
  FBXs locally the moment you have them).
- **Freesound** — has a CC0 filter, but it is per-sound, so it cannot be
  ledgered as a pack. Add individual sounds as `direct` rows once chosen.
- **Poly Pizza** — 10,600+ low-poly models with a documented API, mixed CC0 and
  CC-BY. A good place to shop; only CC0 results may be added here.

---

## 6. Adding a source

1. Confirm the licence **on the source page**, and that it is CC0. If it is
   CC-BY, stop — it does not belong in this ledger.
2. Append one line to `sources.jsonl`. Required: `id`, `class`, `author`,
   `licence`, `resolver`, `page`, `covers`. `covers` must cite the
   `GALLOWS_HYMN.md` section it serves — a source that serves no section is a
   source nobody asked for.
3. Pick a resolver: `kenney` · `ambientcg` · `polyhaven` · `direct` (a stable
   publisher URL) · `manual` (JS-gated download; set `expect` to the filename).
4. `npm run art:vendor && npm run art:credits`.
5. Commit `sources.jsonl`, `sources.lock.json` and `CREDITS.md`. Never commit
   `pipeline/vendor/`.

The three manual sources are manual because Quaternius and itch.io gate their
downloads behind JavaScript. The script prints the exact steps and the exact
destination filename, then hashes and locks the drop on the next run — so a
manual source is still fully covered by the lockfile.
