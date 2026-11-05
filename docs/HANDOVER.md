# HANDOVER — gold-hanzi / Gold Tracing

Written 2026-11-05 (America/New_York) for replacement agents. Follow Meta-AI `handover-guide-standard.md` (on the shared box often at `/workspace/Meta-AI/handover-guide-standard.md`; also in Meta-AI repo). Full dated memory dump: [`HANDOVER-MEMORY.md`](HANDOVER-MEMORY.md).

## 1. Who / what

| | |
|---|---|
| **Product** | Simplified Chinese stroke-order handwriting practice (Vite + React + TS). In-app title **Gold Tracing**. |
| **Repo** | https://github.com/sh4gu4dummy-arch/gold-hanzi (public) |
| **Local clone on shared box** | `/workspace/chinese-trace` (directory name ≠ GitHub name) |
| **Bot role** | gold-hanzi product bot — fold requests, ship on `r`, keep main + GitHub Pages current; Cloudflare friends URL only on explicit live promote |
| **Bot agent id (box)** | `7943196f-2801-4dc5-b095-0798badfd48a` (profile name `gold-hanzi`) |
| **Current version (verified)** | **v0.052** — `src/version.ts` + HEAD `556264837a4ec13d3f1ed2ed7999ebc1d3d9b611` (`v0.052: thicker ink, live green, closer stroke numbers, bigger clear`, commit date 2026-10-03 +0800) |
| **Branches** | `main` = product + GitHub Pages. `live` = Cloudflare Pages production only (explicit promote). Local `live` tip verified ~`28d0f5b` (**v0.013**), **~39 commits behind `main`**. |

### Main source files

- `src/components/TracePad.tsx` (~3.4k lines — practice pad; large but Ash said skip split unless real pain)
- `src/lib/grading.ts`
- `src/pages/Practice.tsx`, `src/pages/Home.tsx`
- `src/index.css`
- `src/lib/homeCatalog.ts`, prefs under `src/lib/*Pref.ts`, `src/version.ts`
- Stroke data: `src/data/strokes/`, bands/lessons under `src/data/`
- Offline launcher: `launch-local.py` / `.sh` / `.bat` (port **8045**)
- GH Pages workflow: `.github/workflows/pages-main.yml` (build base `/gold-hanzi/`)

## 2. How to talk to Ash

- **Ash-direct** in this bot’s chat for results, asks, drafts. QAsupervisor may audit / route handover; do not force QAsup-only for normal product work.
- **`lmk`** = explain only — no implement / edit / push.
- **Spam**: concise results. No mid-task play-by-play unless Ash must act. No empty “folded queue is empty” chatter after ships (standing preference).
- **Ship gate**: **fold-until-r is STRICT** for product changes. Update the plan only until Ash says **`r`**, **`do it now`**, or **`ship it`**. Phrases like “implement … first” / “just add” still mean plan-only until `r`.
- **Ask `r?` only** when folded work exists and is not yet shipped. If the plan is empty, do not ask `r?`.
- **Exceptions**: pure talk; draft/audit/plan-only; this docs handover (explicitly authorized via QAsup/Ash); critical undrawable-pad style regressions historically shipped without waiting (scar — prefer still telling Ash).
- **Trial / try**: Ash may ask for uncommitted try + quick tunnel — OK to edit locally without commit until Ash says `commit` / `r` / ship.
- **Hobby push OK** (Ash 2026-10-15 standing, all bots): commit/push hobby repos without per-push approval. **Never** destructive git (force-push, rewrite history, delete branches/repos, reset away others’ work) without Ash confirming that exact change.
- Prefer built-in Cursor GitHub / `gh` auth. Do not invent connect tools from old memory. Prefer `request_scm_connect`-style connector over pasting PATs in chat.

## 3. Standing Ash rules (still apply)

1. **Fold-until-r** — see §2 and Meta-AI `gold-hanzi-fold-until-r.txt`.
2. **Mobile-first** ~**390×844**. Audits/drafts/UI decisions phone-first; never treat wide desktop as the real layout.
3. **No practice spoilers** — do not show the answer hanzi in context phrases while practicing (pinyin-only phrases / careful aria until cleared). Catch obvious spoiler UX before ship.
4. **Version stamp** — visible `v0.001`-style thousandths in UI (`APP_VERSION` in `src/version.ts`). Bump on every **product** ship commit. `package.json` may stay `0.0.0`.
5. **Benefit vs busywork** — only ship what Ash would notice or that removes real pain. “Don’t do something just to do something.” Honest both-sides eval before cleanup refactors.
6. **No login / streak / nag pressure** — Ash rejected this (2026-09-30).
7. **Cloudflare `live`** — only merge/push/deploy `live` when Ash explicitly asks. Ordinary features go to `main` only.
8. **GitHub Pages** from `main` = personal always-current preview. Cloudflare `https://gold-hanzi.pages.dev` = friends share link (stale until promote).
9. **Local offline** — `./launch-local.sh` after `npm run build`, port **8045**, SPA fallback. **Never use port 8080** (other games). Unique ports for tries (e.g. historical **8052**).
10. **Quick tunnels** — ephemeral trycloudflare one-offs. Do **not** resend the URL unless it changed; tell Ash to hard-refresh the same link.
11. **Grading philosophy** — stroke-following (path), not fat-mask scribble-to-pass. Native speakers struggling ⇒ loosen feel (ink thickness, start/end), not “any scribble wins.” Wider body corridor was **not** taken in v0.052.
12. **Pending remind** — next friendly nudge at **v0.060**, then every +0.010. When Ash says “pending”, list parked items + evaluations. Do not nag every push.
13. **Idea plans** — numbered list; for the next one send what / why / how in simple terms; one-by-one.
14. **Quality over rigid rules** — if a rule would hurt the product, flag rather than blind-break (all-projects standing).
15. **gold-hanzi-sup** is retired — work with Ash directly.

## 4. Memory dump

**Full dump with dates:** [`HANDOVER-MEMORY.md`](HANDOVER-MEMORY.md). Below is the operational digest. Label superseded items as historical; **verified HEAD beats stale “uncommitted” journal notes**.

### Verified current product (v0.052)

- Thicker guide + thicker player ink.
- Softer start/end checks (not a widened body pass corridor).
- Live green while drawing a correct stroke (whole stroke stays green on-path).
- On pass: visible ink snap-clears immediately; passed strokes stay hidden; further drawing blocked until finger lift then next stroke.
- Larger matching stroke-number + direction arrow; number closer, direction-aware, beside start (not covering tip).
- Larger non-modal clear celebration (check / toast / confetti), still dismissable.
- **v0.051 Auto help** next to Replay (solid purple when on; **defaults on**): after **3** fails on same stroke → direction arrow; after **5** → replay that stroke’s guide. Resets on pass / character / level / clear / undo. Off disables.
- Prev/next unlocked character arrows; home meta contrast; My-ink green + outlier trim (v0.045–0.049 lineage).
- Offline launcher port 8045 (v0.047).

### Parked (Ash 2026-10-02 — ask later; **no active approval**)

| # | Idea | Evaluation |
|---|---|---|
| 4 | Retry-this-stroke button next to ▸ Next | **Worth** — clear practice win |
| 5 | Soft pulse once on start-marker | **Worth** — phone noticeability for v0.050 marker |
| 7 | Promote Cloudflare `live` to match `main` | **Worth** — friends on stale ~v0.013 is real pain |
| 8 | Copy link to current character | **Worth** — share without friction |

### Explicitly skip / rejected

- Big TracePad split — under-hood only, regression risk, no feel (**not worth now**).
- Aggressive lazy-load — only if first-open lag returns.
- Cosmetic dead-CSS cleanup — busywork.
- PWA “Add to Home Screen” tip — optional noise.
- Shuffle within unlocked — nice-to-have unless felt.
- Login / streaks — **rejected**.
- Outside-ink soft warn — **REMOVED** (not parked). Ash: not useful after other features.

### Historical / superseded (do not override current)

- Journal notes that “forgiveness / live-green still waiting on r” → **shipped as v0.052**.
- Early “must not block drawing until finger lift” complaint → later Ash **requested** block-until-lift; **v0.052 implements block-until-lift**.
- Old three-gate fat-mask grading as pass gate → **superseded** by stroke-centric grading (see README / `_specs/trace-grading.md`). Fat-mask does not block pass.
- Historical uncommitted try port **8052** + tunnel `https://detective-double-sense-glass.trycloudflare.com/` — **do not claim active** without verifying; tunnels expire. As of handover write, no gold-hanzi listener on 8045/8052 on the box.

## 5. Current status

- **Idle** for product folds — no open folded plan waiting on `r` after v0.052 ship.
- Working tree clean on `main` at handover prep (docs commit will be the next change).
- `main` == `origin/main` at `5562648` before docs push.
- `live` / friends Pages **behind** (~39 commits; tip v0.013). Promote only if Ash asks.
- No `dist/` / `node_modules/` present in clone at handover write (need `npm ci` + build for local).
- No `.grok/` sandbox in this repo. No product code edits in this handover.

## 6. Waiting on Ash

- Nothing actively awaiting `r` for a folded product plan.
- **Parked for later** (Ash said keep on pending list): #4 retry-stroke, #5 marker pulse, #7 live promote, #8 copy link — **no go-ahead yet**.
- Open old soft question (low priority): after spoiler glyph removal, whether to keep pinyin/meaning presentation choices (parked 2026-09-19).

## 7. Desk / preview

| Surface | URL / command | Notes |
|---|---|---|
| GitHub Pages (personal) | https://sh4gu4dummy-arch.github.io/gold-hanzi/ | Auto from `main` via Actions |
| Cloudflare friends | https://gold-hanzi.pages.dev | `live` branch + `wrangler pages deploy … --branch=live` only |
| Local offline | `npm run build` then `./launch-local.sh` → http://127.0.0.1:8045/ | Python SPA server; needs `dist/` |
| Vite HMR | `npm run dev -- --host 0.0.0.0 --port <unique>` | Prefer unique ≠ 8080 |
| Quick tunnel | `cloudflared tunnel --url http://127.0.0.1:<port>` | Ephemeral; don’t resend unchanged URL |

**Promote live (when Ash asks):** merge/reset `live` to `main` carefully as Ash directs → push `origin live` → build with Vite base `./` → `wrangler pages deploy dist --project-name=gold-hanzi --branch=live`. Deploying `--branch=production` only refreshes `production.gold-hanzi.pages.dev` and leaves friends root stale.

**Hosting scars:** A separate Cloudflare Workers Git hook named gold-hanzi on another account historically auto-failed on main (static site, no wrangler.toml). Riverbrook Pages API path is the intended friends deploy. GitHub Pages stays on main.

## 8. Key doc map

- This file + [`HANDOVER-MEMORY.md`](HANDOVER-MEMORY.md) + [`START-HERE.md`](START-HERE.md)
- [`../README.md`](../README.md), [`../GROK_APP_BUILDER.md`](../GROK_APP_BUILDER.md), [`../_specs/trace-grading.md`](../_specs/trace-grading.md)
- Meta-AI (box `/workspace/Meta-AI/`): `handover-guide-standard.md`, `gold-hanzi-fold-until-r.txt`, `local-preview.md`, `START-HERE.md`

## 9. Secrets & hygiene (locations only — never values)

| What | Where (verify existence; never print contents) | Notes |
|---|---|---|
| GitHub workflow / classic PAT (repo+workflow) | `/home/box/agent-data/agents/e87b6ac8-ebc3-49cb-90ab-7ec2a34cb641/secrets/github-workflow-pat` (**mj-bot1**; verified present as a file on this box) | Prefer Cursor GitHub connector / `gh auth`. Do not embed token in `git remote` URL or commit. |
| Historical gold-hanzi / mahj PAT path | `/home/box/agent-data/agents/f06b9f79-7243-46ce-97c8-0c46aa9b07fb/secrets/github-workflow-pat` | **Path absent** on this box at handover — treat as historical alias mention only |
| Cloudflare Pages anon JSON (API token + account id) | Historically mahj secrets file `cloudflare-pages-anon.json` (load `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; never print) | **File not found** on box search at handover — ask Ash/QAsup or mahj holder before live promote |
| Box / host secret stores | `/home/box/agent-data/box-secrets.json`, `host-secrets.json` | Keys only inspected; do not dump |
| Shared Cloudflare account | riverbrook8779@agentmail.to (Pages project `gold-hanzi`, production branch `live`) | Account identity, not a password |

**Never** commit PATs, `.env` bodies, cookies, or paste secrets into public chat/docs. Ash 2026-10-15 allows sharing PAT with other bots when needed via secure path — still never into git.

## 10. Git history cleanup (soft dry-run suggestions only)

Suggestions only. **Do not** rewrite, force-push, filter-repo, or delete without Ash confirming the exact change.

1. Very early pre-v0.001 commits that only tweak Pages base / tunnel Host headers are noisy but harmless — optional squash narrative later; **not urgent**.
2. Rapid thousandths bumps (v0.001→v0.052) are intentional Ash preference — do **not** “clean” them into semver.
3. `live` lagging at v0.013 is a **promote** problem, not a history-rewrite problem.
4. Outside-repo scratch (`/workspace/gold-hanzi-drafts`, `/workspace/gold-hanzi-audit`, assorted `/workspace/audit-*.png`) need not enter git; trial/QA scratch need not be preserved.

## 11. Local materials held (not in repo)

| Path | Summary | Preserve? |
|---|---|---|
| `/workspace/gold-hanzi-drafts/` | Old HTML/PNG UI drafts (draft-a/b/c, demo-stroke-placement) | Optional reference; not required for live product |
| `/workspace/gold-hanzi-audit/` | Snapshot copies of Practice/TracePad/grading/css for audits | Scratch; disposable |
| `/workspace/audit-*.png`, `audit-v041-*.png` | Phone audit screenshots | Scratch |
| `/workspace/Meta-AI/gold-hanzi-fold-until-r.txt` | Standing fold rule text | Keep (Meta-AI) |
| Agent attachments under `…/7943196f-…/attachments/` | User screenshots (e.g. stroke-number placement) | Ephemeral |

No useful `.grok/` sandbox tools were identified to copy into `scripts/` — nothing paused for that reason.

## 12. Risks / gaps for the next agent

- Friends URL staleness until Ash asks to promote `live`.
- Cloudflare anon JSON missing from box search — live promote may need Ash to restore secrets path.
- TracePad size makes careless edits risky; prefer small targeted diffs.
- Memory store has conflicting historical notes — always re-read `version.ts` + `git log -1` before claiming status.
- Catalog/HSK 3.0 lazy-load: classic-first path was hard-won (v0.029); don’t reintroduce full-bundle stall.
