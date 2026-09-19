# Updates from Grok App Builder

Handoff log between **Grok App Builder** (preview + heavy lifting) and whoever is working the GitHub repo (Grok Bot, humans, other agents).

Newest entry first. Keep product truth in this repo. App Builder is a workbench — not a second source of truth.

---

## How to use this file

**App Builder Grok** — add a dated entry when you:

- land a product change that should come back to `main`
- hit a trap the next agent will repeat
- leave work unfinished

**Repo Grok / humans** — read the latest entry before you touch tracing, grading, or routing. If you pull App Builder work back into this repo, note it here too.

Keep entries short. Link files. Do not paste whole diffs.

---

## Two environments (do not mix)

| | GitHub `main` (this repo) | Grok App Builder workspace |
|---|---|---|
| Product | **Source of truth** | Working copy of `main` as of 2026-09-16 |
| Stack | Vite SPA, `react-router-dom`, `src/App.tsx` | TanStack Start file routes (preview host requires this) |
| Routes | `/`, `/practice/:id` | `/`, `/practice/$id` via `src/routes/` |
| Do not copy into this repo | — | `src/lib/auth/`, `src/lib/db.ts`, `server/`, `scripts/grok-pwa-*`, `public/__grok/`, `startup.sh`, `migrations/` |

**Product files that should stay in sync** (copy these, not the platform shell):

- `src/components/TracePad.tsx`
- `src/lib/grading.ts`
- `src/lib/progress.ts`
- `src/lib/theme.ts`
- `src/data/characters.ts`
- `src/data/strokeData.ts`
- `src/data/strokes/*.json`
- `src/pages/Home.tsx` / `src/pages/Practice.tsx` (router imports differ)
- `src/index.css` (App Builder: `src/styles.css` with a Tailwind import prepended)
- `src/version.ts` — bump on every product commit
- `_specs/trace-grading.md`

Router-only differences in pages: `react-router-dom` `Link` / `useParams` here vs `@tanstack/react-router` `Link` / `params={{ id }}` in App Builder. Do not “fix” one to match the other blindly.

---

## Log

### 2026-09-19 — Pinyin top bar, next-char row, dark headphones (v0.031)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `Practice.tsx`, `TracePad.tsx`, `index.css`, `version.ts`

- **Pinyin top bar:** pinyin + manual 🔊 speak sit on the same ceiling row as Home and the version stamp; meaning/band meta drops under that row.
- **Next character row:** Next character CTA shares TracePad `trace-actions` with Next level (moved up together); wipe stays in the footer.
- **Dark headphones:** Auto sound control uses a `currentColor` headphones SVG + dark-mode contrast so on/off states stay visible.

### 2026-09-19 — Load retry, cleared replay, stroke order cues (v0.030)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `strokeData.ts`, `Home.tsx`, `Practice.tsx`, `TracePad.tsx`, `grading.ts`, `index.css`, `version.ts`, `_specs/trace-grading.md`

- **First-load resilience:** lesson/HSK1 loads retry once; failed/empty classic chunks fall back to `ensureBandLoaded`; Home/Practice catch so dynamic-import failures never pageerror or stick on “Loading…”.
- **Cleared replay:** passed overlay reads **“Level N cleared (click to replay)”** and re-runs that level’s demo/guide.
- **Current-stroke markers:** start arrow + white median highlight only on the **active** stroke (not on done strokes).
- **Out-of-order toast:** legitimate later-stroke progress → **“do stroke X first”**; 150% paint-cap on the active stroke still **try again**.

### 2026-09-19 — Snappy classic path; no HSK 3.0 leak (v0.029)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `characters.ts`, `characters-classic.json`, `characters-v3-extra.json`, `charLessons.ts`, `strokeData.ts`, `strokeLessons/` (build), `progress.ts`, `Home.tsx`, `Practice.tsx`, `scripts/generate-snappy-data.mjs`, `vite.config.ts`, `version.ts`

- **Split catalog:** classic HSK 1–6 meta eager; HSK 3.0-only extras (+phrases) lazy via `ensureV3Catalog()` only after toggling HSK 3.0 / v3-only Practice deep-link. No eager full 3k `characters.json` on classic path.
- **Lesson stroke chunks:** build generates ~225 classic + ~252 v3 lesson JSON chunks (gitignored); opening a lesson = one request (+ prefetch next). Removed ~3000 per-char Vite micro-chunks from the classic hot path.
- **Lazy tiles:** band body mounts only when expanded; char grids only when lesson open.
- **Progress cache:** in-memory store + beaten-length map; invalidate on wipe / mark beaten so Home batteries don’t re-parse localStorage thousands of times per render.
- **Leak audit:** while `hskView==='classic'`, no v3 catalog parse and no v3 lesson-module fetches.

### 2026-09-19 — HSK 3.0 through band 9 lazy + phrases toggle (v0.028)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `characters.ts`, `strokeCounts.ts`, `charBands.ts`, `strokes/*` (+399), `strokeData.ts`, `Home.tsx`, `Practice.tsx`, `homePref.ts`, `index.css`, `version.ts`

- **HSK 3.0 catalog:** recognition through **bands 1–9** (~3000 unique Simplified from official list). Bands 7–9 = advanced 1200 split by frequency into 400 each. +399 new v3-only chars with vendored stroke JSON.
- **Super lazy:** classic Home never downloads 3.0-only stroke chunks; geometry loads **per open lesson** (+ prefetch next) only in the active view. Battery pills use eager `STROKE_COUNTS` only. No v3 band modules.
- **Phrases:** `phrase` + `phraseGloss` on essentially all catalog chars (HSK words / CEDICT compounds). Practice **Phrases on/off** (`localStorage` `chinese-trace:phrases-enabled:v1`, default on); Hide / Show; collapsible panel; tap phrase → TTS via `speakHanzi` when sound on.


### 2026-09-19 — Band battery meters and HSK1 context phrases (v0.027)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `Home.tsx`, `Practice.tsx`, `characters.ts`, `homePref.ts`, `index.css`, `version.ts`

- **Band batteries:** replaced per-lesson pill strip with **one equal-size pill per classic HSK band 1–6**. Fill % = **char-cleared / band total** (smoother battery than lesson-cleared with 15–82 lessons/band). Compact row so wipe-all stays visible on mobile; light 1…6 labels.
- **HSK 1 context phrases:** optional `phrase` + `phraseGloss` on all **176** classic HSK 1 entries (natural 2–4 char words/phrases).
- **Practice:** collapsible “Context phrase” panel under pinyin (default collapsed; `localStorage` `chinese-trace:phrase-panel-open:v1`); highlights current character; hidden when no phrase.

### 2026-09-19 — Home info icons, lesson pills, wipe all (v0.026)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `Home.tsx`, `index.css`, `version.ts`

- **Strict / Dev ⓘ:** tiny info icons on the difficulty segment; tap opens a small mobile-friendly popover (title + explanation); removed the old one-liner hint under the toggle.
- **Home lede removed:** dropped the “Trace Simplified characters…” guide copy.
- **HSK 1–6 lesson pills:** sticky header shows classic-band lesson progress as tiny pills (green when a lesson is fully cleared), grouped by band 1–6.
- **wipe all:** red text control moved to the bottom of Home (confirm before clear).

### 2026-09-19 — HSK 5–6 and lesson lazy-load with prefetch (v0.025)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `characters.ts`, `charBands.ts`, `strokeCounts.ts`, `strokeBands/hsk5|hsk6.ts`, `strokes/*`, `strokeData.ts`, `Home.tsx`, `version.ts`, `README.md`

- Classic **HSK 5** (+620) and **HSK 6** (+976) unique characters with vendored stroke JSON; `hskV3` best-effort; lazy band chunks `hsk5` / `hsk6`.
- **Lesson lazy-load:** opening a lesson loads that lesson’s stroke JSON (per-char Vite chunks); **prefetch** the next lesson in the same band.
- **HSK 1 Lesson 1** eager on Home mount. Band `ensureBandLoaded` still covers classic 1–6 for bulk/cold paths.

### 2026-09-19 — Toast polish, Strict hint, first-run tip, HSK 4 (v0.024)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `TracePad.tsx`, `index.css`, `Home.tsx`, `Practice.tsx`, `homePref.ts`, `characters.ts`, `strokeBands/hsk4.ts`, `strokeCounts.ts`, `charBands.ts`, `strokeData.ts`, `strokes/*`, `version.ts`

- **Try-again toast:** moved into `.trace-stage`, top-anchored with fade in/out (~1.1s) so it no longer covers mid-glyph ink.
- **Strict vs Dev hint** on Home under the difficulty toggle.
- **First-run sound tip** on Practice (`🔊 = hear now, 🎧 = auto.`); dismissed once via `localStorage` (`chinese-trace:sound-tip-seen:v1`).
- Classic **HSK 4** unique characters (+447) with vendored stroke JSON + lazy `hsk4` band; `hskV3` best-effort from HSK 3.0 word bands.

### 2026-09-19 — Stroke and level checks, character done outline (v0.023)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `TracePad.tsx`, `index.css`, `version.ts`

- **Stroke complete:** very small green ✓ just outside each completed stroke tip (guide canvas; `#22A06B`).
- **Level beaten:** green check badge on the level pip; beaten pips use DONE_STROKE_GREEN.
- **Character cleared (all levels):** light green outline on `.trace-stage` (`is-char-cleared`); softened stroke done underlay (0.26) so outline is the clear cue; removed per-level accent `is-done` ring. `onDone` fires only when all levels are beaten.

### 2026-09-19 — Ordered strokes, 150% try-again, home bar progress (v0.022)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `grading.ts`, `TracePad.tsx`, `Practice.tsx`, `homeCatalog.ts`, `index.css`, `version.ts`, `_specs/trace-grading.md`

- Practice Home bar shows concise **lesson + band** char-clearance for the current character (`L{n} a/b · HSK k c/d`).
- **Ordered strokes:** `evaluateGrade(mask, prevStrokeDone)` only the active (first incomplete) stroke may newly pass.
- **150% paint cap:** brush-coverage bits vs per-stroke Path2D fill area; over → toast "try again", restore that stroke’s baseline ink only.
- Anti-scribble first steps shipped (order + paint cap).

### 2026-09-19 — Circled levels, demo top pair, dock and wipe polish (v0.021)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `Practice.tsx`, `TracePad.tsx`, `index.css`, `version.ts`

- Level pips restyled to **circled numbers** (number inside circle button); scroll / center-active / end-clamp unchanged under pinyin.
- Demo on/off moved beside Skip/Replay in a pair **above** the tracing grid; Demo removed from bottom dock.
- Dock Auto label reads **Off** when auto sound is off; slightly larger dock icons/labels.
- Next character + Wipe this character's progress share one footer row; Next a bit smaller; ASCII apostrophe in Wipe copy.

### 2026-09-19 — Finish draft UI: levels under pinyin, labeled dock, sound split (v0.020)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `Practice.tsx`, `TracePad.tsx`, `index.css`, `version.ts`

- Level pip strip **portaled** into Practice header **directly under big pinyin** (not under Levels progress chrome inside TracePad). Scroll / center-active / end-clamp unchanged.
- Bottom toolbar is a labeled dock: **Demo · Strokes · Undo · Clear · Auto** with short labels under icons and larger hit targets.
- Sound split: **🔊 next to pinyin** = manual replay only; bottom **🎧 Auto** = auto on/off only. Removed hold-to-toggle from the bottom button.

### 2026-09-19 — Align purple guide with green stroke geometry (v0.019)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `grading.ts`, `TracePad.tsx`, `index.css`, `version.ts`

- **Root cause:** HanziWriter Positioner uses CHARACTER_BOUNDS `(0,-124)→(1024,900)`, so demo/outline strokes sit ~`124·hanziScale` CSS px **above** TracePad guides/mask which assumed a `0…1024` Y origin. Purple (writer) vs green (guide `drawStrokeGuides`) looked vertically split on 三 and friends.
- **Fix:** `HANZI_Y_MIN = -124` + content-center target `HANZI_BOUNDS_CENTER_Y` (388) wired into `applyHanziTransform` / `mapHanziPointToCss` / `contentCenterOffset` so guides, mask, and writer share one transform and still sit on the mi-zi-ge midline. Guide/ink canvases also size to the square `cssSize` (no `width/height: 100%` stretch when the stage is non-square).
- **Also:** TracePad init effect now depends on `strokeData` so a cold `/practice/:id` load still starts after the HSK band chunk arrives (previously stuck on empty pad).

### 2026-09-19 — HSK3, band lazy-load, lesson counts, levels above pad (v0.018)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `characters.ts`, `strokeData.ts`, `strokeBands/*`, `strokeCounts.ts`, `charBands.ts`, `strokes/*`, `homeCatalog.ts`, `Home.tsx`, `TracePad.tsx`, `Practice.tsx`, `index.css`, `version.ts`

- Classic **HSK 3** characters added (unique chars from official 2012 L3 words not already in catalog) with vendored stroke JSON; `hskV3` best-effort.
- Stroke geometry **lazy-loaded by classic HSK band** (`strokeBands/hsk1|2|3`); eager `STROKE_COUNTS` keeps homeCatalog sync. Home warms the open band; TracePad/`charDataLoader` ensure the character’s band.
- Home band headers show **chars cleared/total** and **lessons cleared/total** (lesson cleared = every char fully cleared).
- Practice: level pip strip moved **above** the tracing board (header/pinyin area); Skip/Replay stays pad corner; toolbar stays below.

### 2026-09-19 — Practice header: pinyin, Home, scroll levels (v0.017)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `Practice.tsx`, `TracePad.tsx`, `index.css`, `version.ts`

- Removed spoiler hanzi glyph from practice top bar (no answer giveaway).
- Prominent centered **pinyin** above the pad (tappable to speak); meaning stays as small meta.
- Larger **Home** control (house + label) replaces tiny back chevron.
- Level strip: fixed pip size, horizontal scroll + arrow affordance when many levels; keep current level centered; clamp so end levels stay visible.
- Tighter practice chrome; Skip/Replay corner + toolbar unchanged. Sound 🔊 still manual replay.

### 2026-09-19 — Practice UI: Skip/Replay corner + denser dock (v0.016)


**Who:** gold-hanzi (repo Grok)  
**Paths:** `TracePad.tsx`, `index.css`, `version.ts`

- Removed Watch badge/banner on the tracing screen.
- One top-right corner control on the pad: **Skip** during demo, **Replay** while writing/passed (same button, label swaps). Bottom Skip demo / Replay removed to cut dead space.
- Tighter pad→pip→toolbar dock; larger thumb-friendly toolbar icons and slightly larger level pips. Mobile portrait first.

### 2026-09-19 — Cleared-level review: guide XOR ink (v0.015)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `TracePad.tsx`, `version.ts`

- **Bug:** revisiting beaten levels via pips/`enterReviewMode` painted green Guide **and** restored saved ink (v0.010 “guide under ink”). Post-clear correctly showed green only.
- **Fix:** passed/review is mutually exclusive — default Show my strokes off → guide only; on → ink only (clear guide). Same XOR in toggle, ResizeObserver `passed`, and `applyInkSnapshot`.

### 2026-09-19 — Mandarin TTS detection + sound replay UX (v0.014)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `speak.ts`, `TracePad.tsx`, `Practice.tsx`, `version.ts`, `README.md`

- **Voice pick:** poll `getVoices` / `voiceschanged` up to ~2s; match `zh*`/`cmn*` and common Chinese TTS names (Ting-Ting, Mei-Jia, Xiaoxiao, …). If no matched voice object but `speechSynthesis` exists, still speak with `lang=zh-CN` (OS picks); `no-voice` only when speak cannot be attempted.
- **Replay UX:** tap 🔊 = manual hear now (works with auto Sound off); hold ~400ms = toggle auto Sound. Glyph tap also manual. Auto speak on level start/complete still gated by preference. Clear “No Mandarin voice” note after a successful speak.


### 2026-09-18 — Restore practice pad + CF base + TTS cues (v0.013)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `index.css`, `TracePad.tsx`, `vite.config.ts`, `version.ts`, `README.md`

- **Root cause (empty pad):** v0.012 density pass replaced `.page.practice { flex:1; min-height:0; … }` with a literal `PLACEHOLDER`, breaking the 100dvh flex chain. `.trace-stage` sized with `min(100cqw, 100cqh, …)` then collapsed to 0×0 (black void, no hit target).
- **Fix:** restore `.page.practice`; size the stage with `width:min(100%,520px)` + `max-height:100%` + `aspect-ratio` (no cqh). ResizeObserver skips no-op/degenerate sizes and repaints guide after a real resize.
- **CF deep links:** default Vite `base: '/'` (absolute) so `/practice/:id` does not resolve assets under `/practice/assets/`. GH Pages still builds with `--base=/gold-hanzi/` + `404.html`.
- **Sound:** speak on level start (`runDemoThenWrite`), level complete (`finishPass`), and manual glyph / Sound-on tap.

### 2026-09-18 — Next character, practice density, Mandarin TTS (v0.012)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `Practice.tsx`, `TracePad.tsx`, `homeCatalog.ts`, `soundPref.ts`, `speak.ts`, `index.css`, `version.ts`, `README.md`

- **Next character:** after all levels cleared, CTA navigates to next unlocked id in `entriesForView` / Strict unlock order; end state when none.
- **Density:** compact practice chrome; pad sized from leftover `100dvh`; icon toolbar (Demo / strokes / Undo / Clear / Sound).
- **TTS:** Sound on/off in localStorage (default on); speak on character entry with best zh-CN/zh-Hans voice; no English fallback.

### 2026-09-18 — Undo stroke + final all-strokes memory (v0.011)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `TracePad.tsx`, `homeCatalog.ts`, `Practice.tsx`, `version.ts`, `README.md`

- **Undo stroke:** removes last completed pen gesture (pen-down→up); updates ink store + grading mask; disabled when empty / not writing.
- **Final level:** `levelCount = strokeCount + 1` — last level is full-character memory (no guides). Old beaten levels kept; new level additive for clear/unlock.


### 2026-09-18 — Theme icons, lesson UX, keep green Guide (v0.010)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `ThemeToggle.tsx`, `Home.tsx`, `homeCatalog.ts`, `TracePad.tsx`, `index.css`

- Theme toggle uses sun/moon symbols.
- Lessons open/close independently (12 chars, 3-column grid).
- Green Guide repaints after level pass / resize (no longer wiped blank).


### 2026-09-18 — Home Option C + classic HSK 1–2 (v0.009)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `src/pages/Home.tsx`, `src/lib/homePref.ts`, `src/lib/homeCatalog.ts`, `src/data/characters.ts`, `src/data/strokeData.ts`, `src/data/strokes/*`, `src/index.css`

- Mobile-first home: HSK accordion → ~10-char lessons (one lesson open at a time).
- Toggles (localStorage): classic HSK 1–6 ↔ HSK 3.0 (regroup only); Strict ↔ Dev unlocked.
- Progress stays per character (shared across HSK views).
- Catalog expanded to classic HSK 1–2 characters with vendored stroke JSON (HSK 3.0 labels best-effort / incomplete OK).


### 2026-09-17 — Demo toggle + pen-up purple clear (v0.008)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `src/components/TracePad.tsx`, `src/lib/demoPref.ts`, `src/version.ts`

- Terms: **Demo** = animated stroke-order playback; **Guide** = on-pad trace underlay.
- Demo on/off toggle (persists in `localStorage` key `chinese-trace:demo-enabled:v1`).
- Post-success extra purple clears on pen-up after a stroke passes (not when the next stroke passes).
- Removed “no Done button needed” and grade-meter “follow/finish the stroke” copy.



### 2026-09-17 — Next 10 most-common characters (v0.007)

**Who:** gold-hanzi (repo Grok)  
**Paths:** `src/data/characters.ts`, `src/data/strokeData.ts`, `src/data/strokes/*.json`, `src/version.ts`, `src/pages/Home.tsx`

Added Jun Da ranks 11–20 after the original top 10: 这 个 们 中 来 上 大 为 和 国. Stroke JSON from `hanzi-writer-data`. Version `v0.007`.


### 2026-09-16 — No green surplus ink after a stroke passes (v0.006)

**Who:** Grok App Builder  
**Paths:** `src/components/TracePad.tsx`, `src/version.ts`

After a stroke greens, learner ink on that stroke is still wiped (clean green guide). **New** ink after that stays purple and still stamps toward remaining strokes. Removed `recolorCompletedInk` — that was turning leftover marks dark green on already-passed medians and making 的 look muddy.

Copy `TracePad.tsx` + `version.ts` back to the Vite repo. Router-agnostic.

### 2026-09-16 — App Builder loaded `main` (v0.005)

**Who:** Grok App Builder  
**Repo ref:** `sh4gu4dummy-arch/gold-hanzi` `main` @ `b25c2a6`

Brought Gold Tracing into the App Builder live preview so ash can call in App Builder for heavier work. **No product behavior change.** Version still `v0.005`.

What shipped in the preview only (not committed here on purpose):

- TanStack Start shell around existing Home / Practice / TracePad
- `hanzi-writer` installed for the stroke-order demo
- Home grid + practice pad verified on desktop and phone viewports

What did **not** change: 10 characters, stroke-centric grader, level = stroke count, `localStorage` keys (`chinese-trace:progress:v1`, `chinese-trace:theme:v1`).

**For the next App Builder session:** this repo is still the SPA. Re-sync from `main` before heavy lifting if Bot has moved it. Then port product files, not the whole tree.

**For Grok Bot:** you can keep shipping on Vite + react-router as usual. If App Builder later lands a real feature, it will be listed in a new entry below (above) with the exact paths to copy.

Open follow-ups ash can request: more characters, grading tweaks, UI, or a GitHub push of product work.

---

## Conventions

1. Date headings: `YYYY-MM-DD — short title`.
2. Start with **Who** (App Builder / Bot / human) and a one-line outcome.
3. If code should move, name paths. If it should *not* move, say so.
4. Grading changes must cite `_specs/trace-grading.md`. Do not “simplify” pass rules in passing.
5. Bump `src/version.ts` when product code ships.
