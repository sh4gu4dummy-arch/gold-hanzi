# 汉字描红 · Chinese Trace

A small handwriting practice app for the 20 most common Simplified Chinese characters. Tap a character, watch a slow stroke-order guide, then freehand-trace until the stroke-centric grader passes.

**App Builder / Grok Bot handoff:** [GROK_APP_BUILDER.md](./GROK_APP_BUILDER.md) — notes from Grok App Builder for the other devs. Newest entry first.

## Run

```bash
cd /workspace/chinese-trace
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Open [http://localhost:5173](http://localhost:5173).

## Build

```bash
npm run build
npm run preview -- --host 0.0.0.0 --port 5173
```

## Usage

1. Homepage lists 的 一 是 了 我 不 在 人 有 他 (progress pips show levels beaten).
2. Tap a tile to open practice. **Level count = stroke count** for that character.
3. **Level 1:** full stroke-path guide stays visible while you write.
4. **Level k (k>1):** after a slow whole-character demo, strokes 1..(k−1) are hidden (memory); later strokes still show a path guide.
5. Draw freely on the pad. A level is beaten only when the **app** grades a pass (per-stroke median samples + end-of-stroke) — then it auto-finishes.
6. Bottom pips select/retry levels; unlocking is sequential (beat L1 to unlock L2). Progress persists in `localStorage`.

## Grading

Stroke-centric grading (`_specs/trace-grading.md`). Pass = AND of per-stroke median checks:

1. **Sample hit fraction** ≥ 40% along each median (fuzzy lateral radius ≈ 0.55× ink width)
2. **End-of-stroke** — at least one sample with t ≥ 0.88 must be hit (early stop fails)

Fat-mask cover and 3×3 cells do **not** block pass. Live meter shows **X/Y strokes** completed; passed stroke guides turn green.
Outside-letter ink is drawn for feel but never counted.

## Font

**Ma Shan Zheng** (Google Fonts) for UI titles / character display. TracePad guides + grading use Make-Me-a-Hanzi stroke paths (same as hanzi-writer).

## Stack

Vite + React + TypeScript + react-router-dom + hanzi-writer (slow demo animation). Freehand canvas + bitmap grading for pass detection. Stroke data vendored from hanzi-writer-data in `src/data/strokes/`.

```tsx
<TracePad character="的" accent="#7C5CBF" onDone={() => {}} />
```
