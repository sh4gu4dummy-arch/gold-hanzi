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
