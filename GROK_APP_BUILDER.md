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
